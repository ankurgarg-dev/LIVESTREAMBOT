import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/server/prismaClient';

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const prisma = getPrismaClient();
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ ok: false, error: 'Invalid skill id' }, { status: 400 });
    }

    const body = (await req.json()) as {
      canonicalName?: string;
      skillType?: string;
      status?: string;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.canonicalName === 'string') patch.canonicalName = cleanText(body.canonicalName);
    if (typeof body.skillType === 'string') patch.skillType = cleanText(body.skillType);
    if (typeof body.status === 'string') patch.status = cleanText(body.status);

    const updated = await prisma.skill.update({ where: { id: numericId }, data: patch });
    return NextResponse.json({ ok: true, skill: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update skill';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const prisma = getPrismaClient();
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ ok: false, error: 'Invalid skill id' }, { status: 400 });
    }

    await prisma.skill.delete({ where: { id: numericId } });
    return NextResponse.json({ ok: true, deletedId: numericId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete skill';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
