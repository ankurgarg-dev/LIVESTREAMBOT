import type { InterviewPositionSnapshot } from '@/lib/server/interviewStore';

export type CvJdSkillCategory = 'must_have' | 'common';
export type CvJdSkillMatchType = 'exact' | 'partial' | 'none';

export type CvJdSkillScore = {
  skill: string;
  category: CvJdSkillCategory;
  matched: boolean;
  matchType: CvJdSkillMatchType;
  score: number;
  oneLiner: string;
};

export type CvJdScorecard = {
  overallScore: number;
  mustHaveScore: number;
  commonSkillScore: number;
  mustHaveMatched: number;
  mustHaveTotal: number;
  commonMatched: number;
  commonTotal: number;
  summary: string;
  details: CvJdSkillScore[];
};

export type CvJdDetailedSkillCategory = 'must_have' | 'nice_to_have' | 'tech_stack' | 'focus_area';
export type CvJdDetailedSkillScore = Omit<CvJdSkillScore, 'category'> & {
  category: CvJdDetailedSkillCategory;
};

export type CvJdDetailedScorecard = {
  overallScore: number;
  summary: string;
  details: CvJdDetailedSkillScore[];
};

const STOP_WORDS = new Set([
  'and',
  'or',
  'with',
  'for',
  'the',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'by',
  'from',
  'using',
  'use',
  'good',
  'strong',
  'understanding',
  'knowledge',
  'experience',
  'exposure',
  'skills',
  'skill',
  'ability',
  'hands',
  'must',
  'have',
]);

function clean(input: string): string {
  return String(input || '').trim().replace(/\s+/g, ' ');
}

function norm(input: string): string {
  return clean(input).toLowerCase();
}

function tokenize(input: string): string[] {
  const words = norm(input).split(/[^a-z0-9+#./-]+/g);
  return Array.from(new Set(words.filter((w) => w.length >= 2 && !STOP_WORDS.has(w))));
}

function dedupeSkills(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const skill = clean(raw);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

function parseSkillsFromRoleContext(roleContext: string, label: string): string[] {
  const line = roleContext
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  if (!line) return [];
  const raw = line.slice(line.indexOf(':') + 1);
  return dedupeSkills(raw.split(',').map((x) => x.trim()));
}

function scoreOneSkill(skill: string, cvText: string): CvJdSkillScore {
  const loweredCv = norm(cvText);
  const loweredSkill = norm(skill);
  const tokens = tokenize(skill);

  if (loweredSkill && loweredCv.includes(loweredSkill)) {
    return {
      skill,
      category: 'common',
      matched: true,
      matchType: 'exact',
      score: 100,
      oneLiner: 'Direct mention found in the CV/profile context.',
    };
  }

  const tokenHits = tokens.filter((token) => loweredCv.includes(token));
  const tokenCoverage = tokens.length ? tokenHits.length / tokens.length : 0;
  if (tokenCoverage >= 0.6 && tokenHits.length > 0) {
    return {
      skill,
      category: 'common',
      matched: true,
      matchType: 'partial',
      score: 60,
      oneLiner: `Related evidence found: ${tokenHits.slice(0, 4).join(', ')}.`,
    };
  }

  return {
    skill,
    category: 'common',
    matched: false,
    matchType: 'none',
    score: 0,
    oneLiner: 'No clear evidence found in the CV/profile context.',
  };
}

function averageScore(rows: CvJdSkillScore[]): number {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  return Math.round(total / rows.length);
}

function countMatched(rows: CvJdSkillScore[]): number {
  return rows.filter((row) => row.matched).length;
}

export function computeCvJdScorecard(input: {
  candidateContext?: string;
  roleContext?: string;
  positionSnapshot?: InterviewPositionSnapshot;
}): CvJdScorecard | undefined {
  const candidateContext = clean(input.candidateContext || '');
  if (!candidateContext) return undefined;

  const positionSnapshot = input.positionSnapshot;
  const roleContext = String(input.roleContext || '');

  const mustHave = dedupeSkills(
    positionSnapshot?.must_haves?.length
      ? positionSnapshot.must_haves
      : parseSkillsFromRoleContext(roleContext, 'Must-haves'),
  );
  const commonRaw = dedupeSkills([
    ...(positionSnapshot?.nice_to_haves || []),
    ...(positionSnapshot?.tech_stack || []),
    ...(positionSnapshot?.focus_areas || []),
    ...parseSkillsFromRoleContext(roleContext, 'Tech stack'),
    ...parseSkillsFromRoleContext(roleContext, 'Focus areas'),
  ]);
  const mustHaveKeys = new Set(mustHave.map((x) => x.toLowerCase()));
  const common = commonRaw.filter((x) => !mustHaveKeys.has(x.toLowerCase()));

  if (!mustHave.length && !common.length) return undefined;

  const mustRows = mustHave.map((skill) => ({ ...scoreOneSkill(skill, candidateContext), category: 'must_have' as const }));
  const commonRows = common.map((skill) => ({ ...scoreOneSkill(skill, candidateContext), category: 'common' as const }));

  const mustHaveScore = averageScore(mustRows);
  const commonSkillScore = averageScore(commonRows);
  const mustHaveWeight = mustRows.length ? 0.75 : 0;
  const commonWeight = commonRows.length ? (mustRows.length ? 0.25 : 1) : 0;
  const denominator = mustHaveWeight + commonWeight || 1;
  const overallScore = Math.round(
    (mustHaveScore * mustHaveWeight + commonSkillScore * commonWeight) / denominator,
  );

  const mustHaveMatched = countMatched(mustRows);
  const commonMatched = countMatched(commonRows);
  const summaryParts = [
    mustRows.length ? `${mustHaveMatched}/${mustRows.length} must-have skills matched` : '',
    commonRows.length ? `${commonMatched}/${commonRows.length} common skills matched` : '',
  ].filter(Boolean);

  return {
    overallScore,
    mustHaveScore,
    commonSkillScore,
    mustHaveMatched,
    mustHaveTotal: mustRows.length,
    commonMatched,
    commonTotal: commonRows.length,
    summary: summaryParts.join(' | '),
    details: [...mustRows, ...commonRows],
  };
}

export function computeCvJdDetailedScorecard(input: {
  candidateContext?: string;
  mustHaves?: string[];
  niceToHaves?: string[];
  techStack?: string[];
  focusAreas?: string[];
}): CvJdDetailedScorecard | undefined {
  const candidateContext = clean(input.candidateContext || '');
  if (!candidateContext) return undefined;

  const rows: CvJdDetailedSkillScore[] = [];
  const seen = new Set<string>();
  const addRows = (category: CvJdDetailedSkillCategory, values: string[] | undefined) => {
    for (const skill of dedupeSkills(values || [])) {
      const key = `${category}:${skill.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const scored = scoreOneSkill(skill, candidateContext);
      rows.push({
        skill,
        category,
        matched: scored.matched,
        matchType: scored.matchType,
        score: scored.score,
        oneLiner: scored.oneLiner,
      });
    }
  };

  addRows('must_have', input.mustHaves);
  addRows('nice_to_have', input.niceToHaves);
  addRows('tech_stack', input.techStack);
  addRows('focus_area', input.focusAreas);
  if (!rows.length) return undefined;

  const overallScore = averageScore(
    rows.map((row) => ({
      ...row,
      category: row.category === 'must_have' ? 'must_have' : 'common',
    })),
  );
  const matched = rows.filter((row) => row.matched).length;

  return {
    overallScore,
    summary: `${matched}/${rows.length} competencies matched`,
    details: rows,
  };
}
