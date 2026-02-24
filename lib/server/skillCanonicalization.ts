import { getPrismaClient } from '@/lib/server/prismaClient';

export type CanonicalizeMatchedBy =
  | 'exact_alias'
  | 'phrase_alias'
  | 'regex_alias'
  | 'blocked'
  | 'custom';

export type CanonicalizedSkill = {
  skill_id: number | null;
  confidence: number;
  matched_by: CanonicalizeMatchedBy;
  canonical_name: string | null;
  raw_text: string;
};

type MatchType = 'EXACT' | 'PHRASE' | 'REGEX';

type AliasRow = {
  skillId: number;
  aliasText: string;
  matchType: MatchType;
  confidence: number;
  skill: {
    canonicalName: string;
  };
};

type BlockRuleRow = {
  patternText: string;
  matchType: MatchType;
};

function cleanInput(text: string): string {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function normalizeForExact(text: string): string {
  return cleanInput(text)
    .toLowerCase()
    .replace(/[()[\]{}.,;:!?"'`~]/g, ' ')
    .replace(/[\\|]/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\//g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForPhrase(text: string): string {
  return normalizeForExact(text)
    .replace(/[\/.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesByType(inputRaw: string, aliasRaw: string, matchType: MatchType): boolean {
  const inputExact = normalizeForExact(inputRaw);
  const aliasExact = normalizeForExact(aliasRaw);
  const inputPhrase = normalizeForPhrase(inputRaw);
  const aliasPhrase = normalizeForPhrase(aliasRaw);

  if (!inputExact || !aliasExact) return false;

  if (matchType === 'EXACT') {
    return inputExact === aliasExact || inputPhrase === aliasPhrase;
  }

  if (matchType === 'PHRASE') {
    if (inputExact.includes(aliasExact) || inputPhrase.includes(aliasPhrase)) return true;
    const inputWords = inputPhrase.split(' ').filter(Boolean);
    const aliasWords = aliasPhrase.split(' ').filter(Boolean);
    if (aliasWords.length === 1) {
      return inputWords.includes(aliasWords[0]);
    }
    return false;
  }

  try {
    const regex = new RegExp(aliasRaw, 'i');
    return regex.test(inputRaw);
  } catch {
    return false;
  }
}

async function findAliasMatches(rawText: string, tenantId?: string | null): Promise<AliasRow[]> {
  const prisma = getPrismaClient();
  const aliases = (await prisma.skillAlias.findMany({
    where: tenantId
      ? {
          OR: [{ tenantId }, { tenantId: null }],
        }
      : { tenantId: null },
    include: {
      skill: {
        select: {
          canonicalName: true,
        },
      },
    },
  })) as AliasRow[];

  const matches = aliases.filter((alias) => matchesByType(rawText, alias.aliasText, alias.matchType));
  matches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const rank = (type: MatchType): number => (type === 'EXACT' ? 3 : type === 'PHRASE' ? 2 : 1);
    const byType = rank(b.matchType) - rank(a.matchType);
    if (byType !== 0) return byType;
    return b.aliasText.length - a.aliasText.length;
  });
  return matches;
}

async function isBlocked(rawText: string, skillId: number, tenantId?: string | null): Promise<boolean> {
  const prisma = getPrismaClient();
  const rules = (await prisma.skillBlockRule.findMany({
    where: tenantId
      ? {
          blocksSkillId: skillId,
          OR: [{ tenantId }, { tenantId: null }],
        }
      : {
          blocksSkillId: skillId,
          tenantId: null,
        },
    select: {
      patternText: true,
      matchType: true,
    },
  })) as BlockRuleRow[];

  return rules.some((rule) => matchesByType(rawText, rule.patternText, rule.matchType));
}

export async function canonicalizeSkill(text: string, tenantId?: string | null): Promise<CanonicalizedSkill> {
  const rawText = cleanInput(text);
  if (!rawText) {
    return {
      skill_id: null,
      confidence: 0,
      matched_by: 'custom',
      canonical_name: null,
      raw_text: '',
    };
  }

  const matches = await findAliasMatches(rawText, tenantId);
  for (const match of matches) {
    const blocked = await isBlocked(rawText, match.skillId, tenantId);
    if (blocked) {
      continue;
    }

    const matchedBy: CanonicalizeMatchedBy =
      match.matchType === 'EXACT'
        ? 'exact_alias'
        : match.matchType === 'PHRASE'
          ? 'phrase_alias'
          : 'regex_alias';

    return {
      skill_id: match.skillId,
      confidence: Number(match.confidence || 0),
      matched_by: matchedBy,
      canonical_name: match.skill?.canonicalName ?? null,
      raw_text: rawText,
    };
  }

  const wasBlocked = matches.length > 0;
  return {
    skill_id: null,
    confidence: 0,
    matched_by: wasBlocked ? 'blocked' : 'custom',
    canonical_name: null,
    raw_text: rawText,
  };
}

export async function canonicalizeSkillList(
  values: string[],
  tenantId?: string | null,
): Promise<CanonicalizedSkill[]> {
  const out: CanonicalizedSkill[] = [];
  const seen = new Set<string>();

  for (const raw of values || []) {
    const cleaned = cleanInput(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(await canonicalizeSkill(cleaned, tenantId));
  }

  return out;
}

export const canonicalize_skill = canonicalizeSkill;
