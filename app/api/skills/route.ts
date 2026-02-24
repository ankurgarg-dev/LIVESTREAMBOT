import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/server/prismaClient';

function normalizeTenantId(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function equalTenant(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

export async function GET(req: NextRequest) {
  try {
    const prisma = getPrismaClient();
    const tenantId = normalizeTenantId(req.nextUrl.searchParams.get('tenantId'));

    const rows = await prisma.skill.findMany({
      orderBy: { canonicalName: 'asc' },
      include: {
        aliases: true,
        blockRules: true,
      },
    });

    const skills = rows.map((row: any) => ({
      id: row.id,
      canonicalName: row.canonicalName,
      skillType: row.skillType,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      aliases: (row.aliases || [])
        .filter((a: any) => (tenantId ? equalTenant(a.tenantId, tenantId) || a.tenantId == null : a.tenantId == null))
        .sort((a: any, b: any) => String(a.aliasText).localeCompare(String(b.aliasText))),
      blockRules: (row.blockRules || [])
        .filter((b: any) => (tenantId ? equalTenant(b.tenantId, tenantId) || b.tenantId == null : b.tenantId == null))
        .sort((a: any, b: any) => String(a.patternText).localeCompare(String(b.patternText))),
    }));

    return NextResponse.json({ ok: true, skills });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load skills';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const prisma = getPrismaClient();
    const body = (await req.json()) as {
      canonicalName?: string;
      skillType?: string;
      status?: string;
    };

    const canonicalName = cleanText(body.canonicalName);
    if (!canonicalName) {
      return NextResponse.json({ ok: false, error: 'canonicalName is required' }, { status: 400 });
    }

    const skillType = cleanText(body.skillType || 'concept') || 'concept';
    const status = cleanText(body.status || 'ACTIVE') || 'ACTIVE';

    const all = await prisma.skill.findMany({ select: { id: true, canonicalName: true } });
    const existing = all.find((x: any) => String(x.canonicalName).toLowerCase() === canonicalName.toLowerCase());

    const skill = existing
      ? await prisma.skill.update({
          where: { id: existing.id },
          data: { canonicalName, skillType, status, updatedAt: new Date() },
        })
      : await prisma.skill.create({
          data: { canonicalName, skillType, status },
        });

    return NextResponse.json({ ok: true, skill }, { status: existing ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save skill';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
