import {
  deleteCandidateApplication,
  getCandidateApplication,
  updateCandidateApplicationInterviewSettings,
} from '@/lib/server/candidateStore';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const application = await getCandidateApplication(id);
    if (!application) return NextResponse.json({ ok: false, error: 'Application not found' }, { status: 404 });
    return NextResponse.json({ ok: true, application });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load application';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as {
      interviewAgentType?: 'classic' | 'realtime_screening';
      roomName?: string;
    };
    const updated = await updateCandidateApplicationInterviewSettings(id, {
      interviewAgentType:
        body.interviewAgentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
      roomName: String(body.roomName || '').trim() || undefined,
    });
    return NextResponse.json({ ok: true, application: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update application';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteCandidateApplication(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete application';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
