import { stopRoomRecording } from '@/lib/server/recording';
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

    const stoppedCount = await stopRoomRecording(roomName);
    if (stoppedCount === 0) {
      return NextResponse.json(
        { ok: true, roomName, status: 'not_recording', stoppedCount: 0 },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      roomName,
      status: 'stopped',
      stoppedCount,
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
