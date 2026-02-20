import { deleteInterview, getInterview, updateInterview } from '@/lib/server/interviewStore';
import { NextRequest, NextResponse } from 'next/server';

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
    return NextResponse.json({ ok: true, interview });
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
    const payload = await req.json();
    const interview = await updateInterview(id, payload ?? {});
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
