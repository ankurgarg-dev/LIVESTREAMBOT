import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/server/prismaClient';

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeTenantId(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const prisma = getPrismaClient();
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ ok: false, error: 'Invalid block rule id' }, { status: 400 });
    }

    const body = (await req.json()) as {
      patternText?: string;
      matchType?: 'EXACT' | 'PHRASE' | 'REGEX';
      tenantId?: string | null;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.patternText === 'string') patch.patternText = cleanText(body.patternText);
    if (typeof body.matchType === 'string') patch.matchType = body.matchType;
    if ('tenantId' in body) patch.tenantId = normalizeTenantId(body.tenantId);

    const blockRule = await prisma.skillBlockRule.update({ where: { id: numericId }, data: patch });
    return NextResponse.json({ ok: true, blockRule });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update block rule';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const prisma = getPrismaClient();
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ ok: false, error: 'Invalid block rule id' }, { status: 400 });
    }

    await prisma.skillBlockRule.delete({ where: { id: numericId } });
    return NextResponse.json({ ok: true, deletedId: numericId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete block rule';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
