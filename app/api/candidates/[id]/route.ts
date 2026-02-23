import { getCandidateApplication } from '@/lib/server/candidateStore';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const candidate = await getCandidateApplication(id);
    if (!candidate) return NextResponse.json({ ok: false, error: 'Candidate application not found' }, { status: 404 });
    return NextResponse.json({ ok: true, candidate });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load candidate application';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
