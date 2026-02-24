import { extractTextFromUpload } from '@/lib/server/cvContext';
import { getPrismaClient } from '@/lib/server/prismaClient';
import { NextRequest, NextResponse } from 'next/server';

type MatchType = 'EXACT' | 'PHRASE' | 'REGEX';

type SkillRow = {
  id: number;
  canonicalName: string;
  skillType: string;
  aliases: Array<{ id: number; aliasText: string }>;
};

type CvSuggestion = {
  action: 'add_alias' | 'add_skill';
  sourceText: string;
  canonicalName: string;
  canonicalSkillId: number | null;
  confidence: number;
  reason: string;
  suggestedMatchType: MatchType;
  suggestedSkillType: string;
};

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  if (typeof File !== 'undefined') return value instanceof File;
  return typeof (value as File).arrayBuffer === 'function' && typeof (value as File).size === 'number';
}

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[()[\]{}.,;:!?"'`~]/g, ' ')
    .replace(/[\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitWords(text: string): string[] {
  return normalize(text)
    .split(/[\s/+-]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function initials(text: string): string {
  return splitWords(text)
    .map((w) => w[0] || '')
    .join('')
    .toLowerCase();
}

function extractCandidateTerms(rawText: string): string[] {
  const lines = String(rawText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-*•]\s*/, '');
    for (const part of cleaned.split(/[;,|•]+/)) {
      const value = part.trim();
      if (value) parts.push(value);
    }
  }

  const stop = new Set([
    'curriculum vitae',
    'resume',
    'profile',
    'summary',
    'experience',
    'education',
    'skills',
    'responsibilities',
    'achievements',
  ]);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const value = part.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length < 2 || value.length > 45) continue;
    if (!/[A-Za-z]/.test(value)) continue;
    const words = value.split(/\s+/);
    if (words.length > 5) continue;
    const key = normalize(value);
    if (!key || stop.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function inferSkillType(text: string): string {
  const t = normalize(text);
  if (/(aws|azure|gcp|kubernetes|openshift|cloud)/.test(t)) return 'platform';
  if (/(docker|terraform|kafka|jenkins|git|maven|gradle)/.test(t)) return 'tool';
  if (/(sql|nosql|postgres|mysql|oracle|mongodb|redis)/.test(t)) return 'database';
  if (/(agile|scrum|kanban)/.test(t)) return 'methodology';
  if (/(java|python|typescript|javascript|go|c#|c\+\+|node)/.test(t)) return 'language';
  if (/(spring|react|j2ee|java ee)/.test(t)) return 'framework';
  return 'concept';
}

function scoreAliasToCanonical(sourceText: string, canonicalName: string): number {
  const sNorm = normalize(sourceText);
  const cNorm = normalize(canonicalName);
  if (!sNorm || !cNorm) return 0;
  if (sNorm === cNorm) return 1;

  const sWords = splitWords(sourceText);
  const cWords = splitWords(canonicalName);
  const sSet = new Set(sWords);
  const cSet = new Set(cWords);
  const overlap = Array.from(sSet).filter((x) => cSet.has(x)).length;
  const union = new Set([...sSet, ...cSet]).size || 1;
  const jaccard = overlap / union;

  let score = 0;
  if (jaccard >= 0.5) score = Math.max(score, 0.72);
  if (sNorm.includes(cNorm) || cNorm.includes(sNorm)) score = Math.max(score, 0.74);
  if (initials(sourceText) && initials(sourceText) === initials(canonicalName)) score = Math.max(score, 0.8);
  return score;
}

function hasSkillModels(prisma: any): boolean {
  return Boolean(prisma?.skill?.findMany) && Boolean(prisma?.skillAlias?.findMany);
}

function suggestFromTerms(terms: string[], skills: SkillRow[]): CvSuggestion[] {
  const known = new Set<string>();
  for (const skill of skills) {
    known.add(normalize(skill.canonicalName));
    for (const alias of skill.aliases || []) known.add(normalize(alias.aliasText));
  }

  const suggestions: CvSuggestion[] = [];
  for (const term of terms) {
    const norm = normalize(term);
    if (!norm || known.has(norm)) continue;

    let best: { skill: SkillRow; score: number } | null = null;
    for (const skill of skills) {
      const score = scoreAliasToCanonical(term, skill.canonicalName);
      if (!best || score > best.score) best = { skill, score };
    }

    if (best && best.score >= 0.72) {
      suggestions.push({
        action: 'add_alias',
        sourceText: term,
        canonicalName: best.skill.canonicalName,
        canonicalSkillId: best.skill.id,
        confidence: Number(best.score.toFixed(2)),
        reason: 'Similar to existing canonical skill',
        suggestedMatchType: splitWords(term).length === 1 ? 'EXACT' : 'PHRASE',
        suggestedSkillType: best.skill.skillType,
      });
      continue;
    }

    suggestions.push({
      action: 'add_skill',
      sourceText: term,
      canonicalName: term,
      canonicalSkillId: null,
      confidence: 0.6,
      reason: 'New candidate skill from CV',
      suggestedMatchType: 'PHRASE',
      suggestedSkillType: inferSkillType(term),
    });
  }

  return suggestions.slice(0, 120);
}

export async function POST(req: NextRequest) {
  try {
    const prisma = getPrismaClient();
    if (!hasSkillModels(prisma)) {
      return NextResponse.json({ ok: false, error: 'Skill canonicalization tables are not available yet.' }, { status: 400 });
    }

    const form = await req.formData();
    const cvFile = form.get('cvFile');
    if (!isUploadedFile(cvFile) || cvFile.size <= 0) {
      return NextResponse.json({ ok: false, error: 'CV file is required.' }, { status: 400 });
    }

    const rawText = await extractTextFromUpload(cvFile);
    if (!rawText.trim()) {
      return NextResponse.json({ ok: false, error: 'CV appears empty or unreadable.' }, { status: 400 });
    }

    const skills = (await prisma.skill.findMany({
      select: {
        id: true,
        canonicalName: true,
        skillType: true,
        aliases: { select: { id: true, aliasText: true } },
      },
      orderBy: { canonicalName: 'asc' },
    })) as SkillRow[];

    const terms = extractCandidateTerms(rawText);
    const suggestions = suggestFromTerms(terms, skills);
    return NextResponse.json({
      ok: true,
      extractedTermCount: terms.length,
      suggestionCount: suggestions.length,
      suggestions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import CV';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const prisma = getPrismaClient();
    if (!hasSkillModels(prisma)) {
      return NextResponse.json({ ok: false, error: 'Skill canonicalization tables are not available yet.' }, { status: 400 });
    }

    const body = (await req.json()) as { suggestions?: CvSuggestion[] };
    const incoming = Array.isArray(body.suggestions) ? body.suggestions : [];
    if (!incoming.length) {
      return NextResponse.json({ ok: false, error: 'No suggestions to apply.' }, { status: 400 });
    }

    const allSkills = (await prisma.skill.findMany({
      select: { id: true, canonicalName: true },
    })) as Array<{ id: number; canonicalName: string }>;
    const byName = new Map(allSkills.map((x) => [normalize(x.canonicalName), x]));

    let addedSkills = 0;
    let addedAliases = 0;

    for (const item of incoming) {
      if (!item || !item.sourceText || !item.canonicalName) continue;

      if (item.action === 'add_skill') {
        const key = normalize(item.canonicalName);
        const exists = byName.get(key);
        if (!exists) {
          const row = await prisma.skill.create({
            data: {
              canonicalName: item.canonicalName.trim(),
              skillType: item.suggestedSkillType || 'concept',
              status: 'ACTIVE',
            },
          });
          byName.set(key, { id: row.id, canonicalName: row.canonicalName });
          addedSkills += 1;
        }
        continue;
      }

      const canonical = byName.get(normalize(item.canonicalName));
      if (!canonical) continue;
      const aliasText = item.sourceText.trim();
      if (!aliasText) continue;

      const existing = await prisma.skillAlias.findMany({
        where: { tenantId: null },
        select: { id: true, aliasText: true },
      });
      const dup = existing.some((x: any) => normalize(String(x.aliasText)) === normalize(aliasText));
      if (dup) continue;

      await prisma.skillAlias.create({
        data: {
          skillId: canonical.id,
          aliasText,
          matchType: item.suggestedMatchType || 'PHRASE',
          confidence: Number(item.confidence || 0.7),
          tenantId: null,
        },
      });
      addedAliases += 1;
    }

    return NextResponse.json({
      ok: true,
      appliedCount: addedSkills + addedAliases,
      addedSkills,
      addedAliases,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply CV suggestions';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
