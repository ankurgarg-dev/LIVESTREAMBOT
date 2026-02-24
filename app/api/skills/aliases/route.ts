import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/server/prismaClient';

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeTenantId(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

function equalTenant(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

export async function POST(req: NextRequest) {
  try {
    const prisma = getPrismaClient();
    const body = (await req.json()) as {
      skillId?: number;
      aliasText?: string;
      matchType?: 'EXACT' | 'PHRASE' | 'REGEX';
      confidence?: number;
      tenantId?: string | null;
    };

    const skillId = Number(body.skillId);
    const aliasText = cleanText(body.aliasText);
    const matchType = body.matchType === 'REGEX' || body.matchType === 'PHRASE' ? body.matchType : 'EXACT';
    const confidenceRaw = Number(body.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 1;
    const tenantId = normalizeTenantId(body.tenantId);

    if (!Number.isFinite(skillId) || skillId <= 0) {
      return NextResponse.json({ ok: false, error: 'skillId is required' }, { status: 400 });
    }
    if (!aliasText) {
      return NextResponse.json({ ok: false, error: 'aliasText is required' }, { status: 400 });
    }

    const existing = await prisma.skillAlias.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId: null },
      select: { id: true, aliasText: true, tenantId: true },
    });
    const duplicate = existing.find((x: any) => equalTenant(x.tenantId, tenantId) && String(x.aliasText).toLowerCase() === aliasText.toLowerCase());
    if (duplicate) {
      const updated = await prisma.skillAlias.update({
        where: { id: duplicate.id },
        data: { skillId, aliasText, matchType, confidence, updatedAt: new Date() },
      });
      return NextResponse.json({ ok: true, alias: updated, upserted: true });
    }

    const alias = await prisma.skillAlias.create({
      data: { skillId, aliasText, matchType, confidence, tenantId },
    });

    return NextResponse.json({ ok: true, alias }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create alias';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
