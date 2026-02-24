import { getPrismaClient } from '@/lib/server/prismaClient';

function normalizeSkillKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export async function buildSkillTypeByName(): Promise<Record<string, string>> {
  const prisma = getPrismaClient() as any;
  if (!prisma?.skill?.findMany) return {};

  const rows = (await prisma.skill.findMany({
    where: { status: 'ACTIVE' },
    select: {
      canonicalName: true,
      skillType: true,
      aliases: {
        select: {
          aliasText: true,
        },
      },
    },
  })) as Array<{ canonicalName: string; skillType: string; aliases?: Array<{ aliasText: string }> }>;

  const map: Record<string, string> = {};
  for (const row of rows) {
    const skillType = String(row.skillType || '').trim();
    if (!skillType) continue;
    const canonicalKey = normalizeSkillKey(row.canonicalName);
    if (canonicalKey) map[canonicalKey] = skillType;
    for (const alias of row.aliases || []) {
      const aliasKey = normalizeSkillKey(alias.aliasText);
      if (aliasKey && !map[aliasKey]) {
        map[aliasKey] = skillType;
      }
    }
  }
  return map;
}
