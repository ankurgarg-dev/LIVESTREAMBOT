import { getLatestInterviewByRoom, updateInterview } from '@/lib/server/interviewStore';
import {
  buildRecordingPublicUrl,
  createEgressClient,
  extractEgressFilepath,
  listActiveRoomRecordings,
  stopRoomRecording,
} from '@/lib/server/recording';
import { NextRequest, NextResponse } from 'next/server';

async function readRoomName(req: NextRequest): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get('roomName');
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  try {
    const body = await req.json();
    if (typeof body.roomName === 'string' && body.roomName.trim()) {
      return body.roomName.trim();
    }
  } catch {
    // Ignore non-JSON body for backwards compatible GET usage.
  }
  return null;
}

async function handleStop(req: NextRequest) {
  try {
    const roomName = await readRoomName(req);
    if (!roomName) {
      return NextResponse.json({ error: 'Missing roomName parameter' }, { status: 400 });
    }

    const egressClient = createEgressClient();
    const activeBeforeStop = await listActiveRoomRecordings(egressClient, roomName);
    const stoppedCount = await stopRoomRecording(roomName);
    if (stoppedCount === 0) {
      return NextResponse.json(
        { ok: true, roomName, status: 'not_recording', stoppedCount: 0 },
        { status: 404 },
      );
    }

    const fallbackFilepath = activeBeforeStop
      .map((item) => extractEgressFilepath(item))
      .find((value): value is string => Boolean(value));
    const recordingUrl = fallbackFilepath ? buildRecordingPublicUrl(fallbackFilepath) : null;
    if (recordingUrl) {
      const interview = await getLatestInterviewByRoom(roomName);
      if (interview?.id) {
        await updateInterview(interview.id, { recordingUrl });
      }
    }

    return NextResponse.json({
      ok: true,
      roomName,
      status: 'stopped',
      stoppedCount,
      recordingUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop room recording';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleStop(req);
}

export async function POST(req: NextRequest) {
  return handleStop(req);
}
