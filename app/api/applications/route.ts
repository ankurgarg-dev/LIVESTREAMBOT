import { listCandidateApplications } from '@/lib/server/candidateStore';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const applications = await listCandidateApplications();
    return NextResponse.json({ ok: true, applications });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load applications';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
