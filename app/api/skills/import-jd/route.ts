import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/server/prismaClient';

type ImportPayload = {
  must_haves?: string[];
  nice_to_haves?: string[];
  tech_stack?: string[];
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function toSkillType(category: 'must_haves' | 'nice_to_haves' | 'tech_stack'): string {
  if (category === 'tech_stack') return 'tool';
  return 'concept';
}

export async function POST(req: NextRequest) {
  try {
    const prisma = getPrismaClient();
    const body = (await req.json()) as ImportPayload;

    const grouped: Record<'must_haves' | 'nice_to_haves' | 'tech_stack', string[]> = {
      must_haves: dedupe(Array.isArray(body.must_haves) ? body.must_haves : []),
      nice_to_haves: dedupe(Array.isArray(body.nice_to_haves) ? body.nice_to_haves : []),
      tech_stack: dedupe(Array.isArray(body.tech_stack) ? body.tech_stack : []),
    };

    const allExisting = await prisma.skill.findMany({ select: { id: true, canonicalName: true } });
    const byLower = new Map<string, { id: number; canonicalName: string }>();
    for (const row of allExisting as Array<{ id: number; canonicalName: string }>) {
      byLower.set(String(row.canonicalName).toLowerCase(), row);
    }

    const added: Array<{ id: number; canonicalName: string; skillType: string }> = [];
    const updated: Array<{ id: number; canonicalName: string; skillType: string }> = [];

    for (const category of ['must_haves', 'nice_to_haves', 'tech_stack'] as const) {
      for (const skill of grouped[category]) {
        const key = skill.toLowerCase();
        const skillType = toSkillType(category);
        const existing = byLower.get(key);
        if (existing) {
          const row = await prisma.skill.update({
            where: { id: existing.id },
            data: { canonicalName: skill, skillType, status: 'ACTIVE', updatedAt: new Date() },
          });
          updated.push({ id: row.id, canonicalName: row.canonicalName, skillType: row.skillType });
          continue;
        }

        const row = await prisma.skill.create({
          data: { canonicalName: skill, skillType, status: 'ACTIVE' },
        });
        byLower.set(key, { id: row.id, canonicalName: row.canonicalName });
        added.push({ id: row.id, canonicalName: row.canonicalName, skillType: row.skillType });
      }
    }

    return NextResponse.json({
      ok: true,
      importedCount: added.length + updated.length,
      addedCount: added.length,
      updatedCount: updated.length,
      added,
      updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import JD skills';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
