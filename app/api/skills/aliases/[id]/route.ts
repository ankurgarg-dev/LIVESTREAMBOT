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
      return NextResponse.json({ ok: false, error: 'Invalid alias id' }, { status: 400 });
    }

    const body = (await req.json()) as {
      aliasText?: string;
      matchType?: 'EXACT' | 'PHRASE' | 'REGEX';
      confidence?: number;
      tenantId?: string | null;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.aliasText === 'string') patch.aliasText = cleanText(body.aliasText);
    if (typeof body.matchType === 'string') patch.matchType = body.matchType;
    if (typeof body.confidence === 'number') patch.confidence = Math.max(0, Math.min(1, body.confidence));
    if ('tenantId' in body) patch.tenantId = normalizeTenantId(body.tenantId);

    const alias = await prisma.skillAlias.update({ where: { id: numericId }, data: patch });
    return NextResponse.json({ ok: true, alias });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update alias';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const prisma = getPrismaClient();
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ ok: false, error: 'Invalid alias id' }, { status: 400 });
    }

    await prisma.skillAlias.delete({ where: { id: numericId } });
    return NextResponse.json({ ok: true, deletedId: numericId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete alias';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
