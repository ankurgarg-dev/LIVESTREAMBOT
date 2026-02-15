import {
  attachInterviewAsset,
  createInterview,
  listInterviews,
  type InterviewCreateInput,
} from '@/lib/server/interviewStore';
import { RoomServiceClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

function readRequiredText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value.trim();
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  if (typeof File !== 'undefined') return value instanceof File;
  return typeof (value as File).arrayBuffer === 'function' && typeof (value as File).size === 'number';
}

function normalizeRoomName(raw: string): string {
  const safe = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return safe || 'agent-test-room';
}

function toHttpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  return parsed.toString();
}

async function ensureRoomExists(roomName: string): Promise<void> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !livekitUrl) return;

  try {
    const client = new RoomServiceClient(toHttpUrl(livekitUrl), apiKey, apiSecret);
    await client.createRoom({ name: roomName, emptyTimeout: 10 * 60 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('already exists')) {
      return;
    }
    throw error;
  }
}

export async function GET() {
  try {
    const interviews = await listInterviews();
    return NextResponse.json({ ok: true, interviews });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load interviews';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const durationRaw = readRequiredText(form, 'durationMinutes');
    const duration = Number(durationRaw);
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: 'durationMinutes must be a positive number' }, { status: 400 });
    }

    const requestedRoomName = String(form.get('roomName') ?? '').trim();
    const defaultRoomName = process.env.LIVEKIT_ROOM || 'agent-test-room';

    const input: InterviewCreateInput = {
      roomName: normalizeRoomName(requestedRoomName || defaultRoomName),
      candidateName: readRequiredText(form, 'candidateName'),
      candidateEmail: readRequiredText(form, 'candidateEmail'),
      interviewerName: readRequiredText(form, 'interviewerName'),
      interviewerEmail: String(form.get('interviewerEmail') ?? '').trim(),
      jobTitle: readRequiredText(form, 'jobTitle'),
      jobDepartment: String(form.get('jobDepartment') ?? '').trim(),
      scheduledAt: readRequiredText(form, 'scheduledAt'),
      durationMinutes: duration,
      timezone: String(form.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone).trim(),
      notes: String(form.get('notes') ?? '').trim(),
    };

    // Room provisioning is best-effort: interview setup must still save even if
    // the LiveKit RoomService endpoint is temporarily unavailable.
    try {
      await ensureRoomExists(input.roomName);
    } catch (error) {
      console.error('[interviews] ensureRoomExists failed, continuing with setup save:', error);
    }

    let interview = await createInterview(input);
    const cvFile = form.get('cv');
    const jdFile = form.get('jd');

    if (isUploadedFile(cvFile) && cvFile.size > 0) {
      interview = await attachInterviewAsset(interview.id, 'cv', cvFile);
    }
    if (isUploadedFile(jdFile) && jdFile.size > 0) {
      interview = await attachInterviewAsset(interview.id, 'jd', jdFile);
    }

    return NextResponse.json({ ok: true, interview }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create interview';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
