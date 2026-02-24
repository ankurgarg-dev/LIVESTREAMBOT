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
      blocksSkillId?: number;
      patternText?: string;
      matchType?: 'EXACT' | 'PHRASE' | 'REGEX';
      tenantId?: string | null;
    };

    const blocksSkillId = Number(body.blocksSkillId);
    const patternText = cleanText(body.patternText);
    const matchType = body.matchType === 'REGEX' || body.matchType === 'PHRASE' ? body.matchType : 'EXACT';
    const tenantId = normalizeTenantId(body.tenantId);

    if (!Number.isFinite(blocksSkillId) || blocksSkillId <= 0) {
      return NextResponse.json({ ok: false, error: 'blocksSkillId is required' }, { status: 400 });
    }
    if (!patternText) {
      return NextResponse.json({ ok: false, error: 'patternText is required' }, { status: 400 });
    }

    const existing = await prisma.skillBlockRule.findMany({
      where: { blocksSkillId },
      select: { id: true, patternText: true, tenantId: true },
    });
    const duplicate = existing.find((x: any) => equalTenant(x.tenantId, tenantId) && String(x.patternText) === patternText);
    if (duplicate) {
      const updated = await prisma.skillBlockRule.update({
        where: { id: duplicate.id },
        data: { patternText, matchType, updatedAt: new Date() },
      });
      return NextResponse.json({ ok: true, blockRule: updated, upserted: true });
    }

    const blockRule = await prisma.skillBlockRule.create({
      data: { blocksSkillId, patternText, matchType, tenantId },
    });
    return NextResponse.json({ ok: true, blockRule }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create block rule';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
