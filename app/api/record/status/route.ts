import { createEgressClient, listActiveRoomRecordings } from '@/lib/server/recording';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName')?.trim();
    if (!roomName) {
      return NextResponse.json({ error: 'Missing roomName parameter' }, { status: 400 });
    }

    const egressClient = createEgressClient();
    const active = await listActiveRoomRecordings(egressClient, roomName);
    return NextResponse.json({
      ok: true,
      roomName,
      isRecording: active.length > 0,
      activeEgress: active.map((item) => ({
        egressId: item.egressId,
        startedAt: item.startedAt ? item.startedAt.toString() : null,
        status: item.status,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch room recording status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
