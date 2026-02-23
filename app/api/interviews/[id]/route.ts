import { deleteInterview, getInterview, updateInterview } from '@/lib/server/interviewStore';
import { computeCvJdScorecard } from '@/lib/server/cvJdScoring';
import { NextRequest, NextResponse } from 'next/server';

function isScoreAffectingPatch(payload: Record<string, unknown>): boolean {
  return (
    'candidateContext' in payload ||
    'roleContext' in payload ||
    'positionSnapshot' in payload ||
    'candidateName' in payload ||
    'jobTitle' in payload
  );
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const interview = await getInterview(id);
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }
    const cvJdScorecard =
      interview.cvJdScorecard ||
      computeCvJdScorecard({
        candidateContext: interview.candidateContext,
        roleContext: interview.roleContext,
        positionSnapshot: interview.positionSnapshot,
      });
    return NextResponse.json({ ok: true, interview: { ...interview, cvJdScorecard } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load interview';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const payload = ((await req.json()) ?? {}) as Record<string, unknown>;
    let interview = await updateInterview(id, payload);

    if (isScoreAffectingPatch(payload) || !interview.cvJdScorecard) {
      const scorecard = computeCvJdScorecard({
        candidateContext: interview.candidateContext,
        roleContext: interview.roleContext,
        positionSnapshot: interview.positionSnapshot,
      });
      interview = await updateInterview(id, { cvJdScorecard: scorecard });
    }

    return NextResponse.json({ ok: true, interview });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update interview';
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const deleted = await deleteInterview(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deletedId: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete interview';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
