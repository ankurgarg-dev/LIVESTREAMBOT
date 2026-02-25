import { randomString } from '@/lib/client-utils';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { ensureAgentInRoom } from '@/lib/server/agentControl';
import { getLatestCandidateApplicationByRoom } from '@/lib/server/candidateStore';
import { createInterview, getLatestInterviewByRoom } from '@/lib/server/interviewStore';
import { ConnectionDetails } from '@/lib/types';
import { AccessToken, AccessTokenOptions, RoomServiceClient, VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const COOKIE_KEY = 'random-participant-postfix';

function normalizeList(values: unknown[]): string[] {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function canonicalSkillToName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const typed = value as { canonical_name?: unknown; raw_text?: unknown };
  return String(typed.canonical_name || typed.raw_text || '').trim();
}

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const roomName = request.nextUrl.searchParams.get('roomName');
    const participantName = request.nextUrl.searchParams.get('participantName');
    const requestedAgentType = request.nextUrl.searchParams.get('agentType');
    const metadata = request.nextUrl.searchParams.get('metadata') ?? '';
    const region = request.nextUrl.searchParams.get('region');
    if (!LIVEKIT_URL) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;
    let randomParticipantPostfix = request.cookies.get(COOKIE_KEY)?.value;
    if (livekitServerUrl === undefined) {
      throw new Error('Invalid region');
    }

    if (typeof roomName !== 'string') {
      return new NextResponse('Missing required query parameter: roomName', { status: 400 });
    }
    if (participantName === null) {
      return new NextResponse('Missing required query parameter: participantName', { status: 400 });
    }

    let latestInterview = await getLatestInterviewByRoom(roomName);
    const latestApplication = latestInterview ? undefined : await getLatestCandidateApplicationByRoom(roomName);
    if (!latestInterview && latestApplication) {
      try {
        latestInterview = await createInterview({
          roomName,
          candidateName: String(latestApplication.candidateName || 'Candidate'),
          candidateEmail: String(latestApplication.candidateEmail || '').trim() || 'unknown@example.com',
          interviewerName: 'Interviewer Bot',
          interviewerEmail: '',
          jobTitle: String(latestApplication.positionId || 'Position'),
          jobDepartment: '',
          scheduledAt: String(latestApplication.updatedAt || latestApplication.createdAt || new Date().toISOString()),
          durationMinutes: 30,
          timezone: 'UTC',
          notes: 'Auto-created from application room join',
          agentType: latestApplication.interviewAgentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
          candidateContext: latestApplication.candidateContext || '',
          roleContext: latestApplication.roleContext || '',
          positionId: latestApplication.positionId || undefined,
          cvJdScorecard: latestApplication.cvJdScorecard,
        });
      } catch (error) {
        console.error('[connection-details] failed to auto-create interview from application:', error);
      }
    }
    const agentType =
      requestedAgentType === 'realtime_screening' ||
      latestInterview?.agentType === 'realtime_screening' ||
      latestApplication?.interviewAgentType === 'realtime_screening'
        ? 'realtime_screening'
        : 'classic';

    try {
      await ensureRoomExists(roomName);
    } catch (error) {
      console.error('[connection-details] ensureRoomExists failed:', error);
    }

    ensureAgentInRoom(roomName, agentType).catch((error) => {
      console.error('[connection-details] agent auto-join request failed:', error);
    });

    // Generate participant token
    if (!randomParticipantPostfix) {
      randomParticipantPostfix = randomString(4);
    }
    const participantToken = await createParticipantToken(
      {
        identity: `${participantName}__${randomParticipantPostfix}`,
        name: participantName,
        metadata,
      },
      roomName,
    );

    const interviewMustHaveSkills = latestInterview?.positionSnapshot?.must_haves
      ? normalizeList(latestInterview.positionSnapshot.must_haves)
      : [];
    const interviewRequiredTechStack = latestInterview?.positionSnapshot?.tech_stack
      ? normalizeList(latestInterview.positionSnapshot.tech_stack)
      : [];
    const interviewGoodToHaveSkills = latestInterview?.positionSnapshot?.nice_to_haves
      ? normalizeList(latestInterview.positionSnapshot.nice_to_haves)
      : [];
    const applicationMustHaveSkills = normalizeList(
      Array.isArray(latestApplication?.canonical_skills?.must_haves)
        ? latestApplication.canonical_skills.must_haves.map(canonicalSkillToName)
        : [],
    );
    const applicationRequiredTechStack = normalizeList(
      Array.isArray(latestApplication?.canonical_skills?.tech_stack)
        ? latestApplication.canonical_skills.tech_stack.map(canonicalSkillToName)
        : [],
    );
    const applicationGoodToHaveSkills = normalizeList(
      Array.isArray(latestApplication?.canonical_skills?.nice_to_haves)
        ? latestApplication.canonical_skills.nice_to_haves.map(canonicalSkillToName)
        : [],
    );
    const mustHaveSkills = interviewMustHaveSkills.length ? interviewMustHaveSkills : applicationMustHaveSkills;
    const requiredTechStack = interviewRequiredTechStack.length
      ? interviewRequiredTechStack
      : applicationRequiredTechStack;
    const goodToHaveSkills = interviewGoodToHaveSkills.length
      ? interviewGoodToHaveSkills
      : applicationGoodToHaveSkills;
    const defaultCurrentSkill = mustHaveSkills[0] || '';

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName: roomName,
      participantToken: participantToken,
      participantName: participantName,
      interviewContext: latestInterview
        ? {
            interviewId: latestInterview.id,
            agentType,
            candidateContext: latestInterview.candidateContext || '',
            roleContext: latestInterview.roleContext || '',
            mustHaveSkills,
            requiredTechStack,
            goodToHaveSkills,
            currentQuestion: '',
            currentSkill: defaultCurrentSkill,
            currentTopic: defaultCurrentSkill,
          }
        : latestApplication
          ? {
              interviewId: latestApplication.id,
              agentType,
              candidateContext: latestApplication.candidateContext || '',
              roleContext: latestApplication.roleContext || '',
              mustHaveSkills,
              requiredTechStack,
              goodToHaveSkills,
              currentQuestion: '',
              currentSkill: defaultCurrentSkill,
              currentTopic: defaultCurrentSkill,
            }
        : undefined,
    };
    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_KEY}=${randomParticipantPostfix}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to create connection details' }, { status: 500 });
  }
}

async function ensureRoomExists(roomName: string): Promise<void> {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) return;
  const client = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  try {
    await client.createRoom({ name: roomName, emptyTimeout: 10 * 60 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/already exists|exists|ALREADY_EXISTS/i.test(message)) {
      throw error;
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = '5m';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}

function getCookieExpirationTime(): string {
  var now = new Date();
  var time = now.getTime();
  var expireTime = time + 60 * 120 * 1000;
  now.setTime(expireTime);
  return now.toUTCString();
}
