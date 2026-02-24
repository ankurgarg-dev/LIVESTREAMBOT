import {
  DEEP_DIVE_MODES,
  DURATIONS,
  EVALUATION_POLICIES,
  FOCUS_AREAS,
  LEVELS,
  STRICTNESS_LEVELS,
  type PositionConfigCore,
  type PositionExtraction,
  type SkillCalibrationItem,
  type TechStackMetaItem,
} from './types';
const DEFAULT_DURATION = 60;
const JD_SKILL_PATTERNS: Array<[RegExp, string]> = [
  [/\bpython\b/i, 'Python'],
  [/\bjava\b/i, 'Java'],
  [/\bj2ee\b|\bjee\b/i, 'J2EE'],
  [/\bspring\s*boot\b/i, 'Spring Boot'],
  [/\bobject[-\s]*oriented\b|\bood\b|\boop\b/i, 'Object-Oriented Design'],
  [/\bdesign patterns?\b/i, 'Design Patterns'],
  [/\bdata structures?\b/i, 'Data Structures'],
  [/\bscalab(le|ility)\b|\bsystem architecture\b/i, 'System Design'],
  [/\bmicro[\s-]*services?\b/i, 'Microservices'],
  [/\bdistributed computing\b|\bdistributed systems?\b/i, 'Distributed Computing'],
  [/\brest(ful)?\b|\brest apis?\b/i, 'REST APIs'],
  [/\bsql\b/i, 'SQL'],
  [/\bnosql\b/i, 'NoSQL'],
  [/\bmq\b|\bmessage queue\b/i, 'MQ'],
  [/\bkafka\b/i, 'Kafka'],
  [/\bterraform\b|\biac\b|\binfrastructure as code\b/i, 'Terraform'],
  [/\bci\/?cd\b|\bcontinuous integration\b|\bcontinuous delivery\b|\bcontinuous deployment\b/i, 'CI/CD'],
  [/\bdocker\b/i, 'Docker'],
  [/\bkubernetes\b|\bk8s\b/i, 'Kubernetes'],
  [/\baws\b|\bamazon web services\b|\bcloud\b/i, 'AWS'],
  [/\bautomation testing\b/i, 'Automation Testing'],
  [/\bunit testing\b|\bunit test\b/i, 'Unit Testing'],
  [/\bintegration testing\b|\bintegration test\b/i, 'Integration Testing'],
  [/\bagile\b/i, 'Agile'],
  [/\bbatch\b/i, 'Batch Processing'],
  [/\banalytics?\b/i, 'Analytics Platforms'],
  [/\bdata platforms?\b/i, 'Data Platforms'],
  [/\bgenai\b|\bgenerative ai\b/i, 'GenAI'],
  [/\brag\b|\bretrieval[-\s]*augmented generation\b/i, 'Retrieval-Augmented Generation (RAG)'],
  [/\blangchain\b/i, 'LangChain'],
  [/\bvector (db|database|databases)\b|\bvector store\b|\bvector index(es)?\b/i, 'Vector Databases'],
  [/\basync\b|\basynchronous\b|\basyncio\b/i, 'Async Programming'],
  [/\bmcp\b|\bmodel context protocol\b|\bmcp servers?\b/i, 'MCP Servers'],
  [/\bllms?\b|\blarge language models?\b/i, 'LLMs'],
  [/\bagentic ai\b|\bagentic\b/i, 'Agentic AI'],
];
const NON_TECH_STACK_SKILLS = new Set([
  'Problem Solving',
  'Communication',
  'Technical Leadership',
  'Coding Fundamentals',
]);
const SOFT_OR_GENERIC_SKILLS = new Set([
  'Problem Solving',
  'Communication',
  'Technical Leadership',
  'Coding Fundamentals',
]);
const TECH_STACK_TYPES = new Set(['tool', 'platform', 'framework', 'database']);
const RUNTIME_LANGUAGE_ALLOWLIST = new Set([
  'java',
  'javascript',
  'typescript',
  'python',
  'ruby',
  'go',
  'c#',
  'csharp',
  'scala',
  'kotlin',
  'groovy',
]);
const STACK_SECTION_PATTERN = /\b(tech stack|technology stack|tools?|tooling|environment|platforms?)\b/i;
type SkillEvidenceSection = 'neutral' | 'must' | 'nice' | 'tech';
type TechStackCandidate = {
  skillId?: number | null;
  canonicalName?: string | null;
  skillType?: string | null;
  displayText: string;
  evidenceSection?: SkillEvidenceSection;
  sourceSection?: SkillEvidenceSection;
};

function isOneOf<T extends string | number>(value: unknown, source: readonly T[]): value is T {
  return source.includes(value as T);
}

export function clamp01(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function validateExtractionShape(payload: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const p = payload as Record<string, unknown>;

  const required = [
    'role_title',
    'level',
    'recommended_duration_minutes',
    'must_haves',
    'nice_to_haves',
    'tech_stack',
    'focus_areas',
    'deep_dive_mode',
    'strictness',
    'evaluation_policy',
    'notes_for_interviewer',
    'confidence',
    'missing_fields',
    'extraction_rationale',
  ];

  for (const key of required) {
    if (!(key in p)) errors.push(`Missing field: ${key}`);
  }

  const arrayFields = ['must_haves', 'nice_to_haves', 'tech_stack', 'focus_areas', 'missing_fields'];
  for (const key of arrayFields) {
    if (!Array.isArray(p[key])) errors.push(`${key} must be an array`);
  }

  if (typeof p.role_title !== 'string') errors.push('role_title must be string');
  if (typeof p.level !== 'string') errors.push('level must be string');
  if (typeof p.recommended_duration_minutes !== 'number') errors.push('recommended_duration_minutes must be number');
  if (typeof p.deep_dive_mode !== 'string') errors.push('deep_dive_mode must be string');
  if (typeof p.strictness !== 'string') errors.push('strictness must be string');
  if (typeof p.evaluation_policy !== 'string') errors.push('evaluation_policy must be string');
  if (typeof p.notes_for_interviewer !== 'string') errors.push('notes_for_interviewer must be string');

  const conf = p.confidence as Record<string, unknown>;
  if (!conf || typeof conf !== 'object') {
    errors.push('confidence must be object');
  } else {
    for (const key of ['level', 'must_haves', 'tech_stack', 'overall']) {
      const v = conf[key];
      if (typeof v !== 'number' || v < 0 || v > 1) errors.push(`confidence.${key} must be number 0..1`);
    }
  }

  const rationale = p.extraction_rationale as Record<string, unknown>;
  if (!rationale || typeof rationale !== 'object') {
    errors.push('extraction_rationale must be object');
  } else {
    if (typeof rationale.level !== 'string') errors.push('extraction_rationale.level must be string');
  }

  return { ok: errors.length === 0, errors };
}

export function parseJsonWithFallback(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty response');
  return JSON.parse(trimmed);
}

function normalizeItem(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeLookupKey(text: string): string {
  return normalizeItem(text).toLowerCase();
}

function normalizeSkillType(skillType: unknown): string | null {
  const normalized = normalizeLookupKey(String(skillType || ''));
  if (!normalized) return null;
  if (
    normalized === 'language' ||
    normalized === 'framework' ||
    normalized === 'concept' ||
    normalized === 'tool' ||
    normalized === 'platform' ||
    normalized === 'database' ||
    normalized === 'domain' ||
    normalized === 'methodology' ||
    normalized === 'general'
  ) {
    return normalized;
  }
  return null;
}

function resolveSkillTypeFromMap(
  skillTypeByName: Record<string, string> | undefined,
  canonicalName: string,
  displayText: string,
): string | null {
  if (!skillTypeByName) return null;
  const byCanonical = skillTypeByName[normalizeLookupKey(canonicalName)];
  if (byCanonical) return byCanonical;
  const byDisplay = skillTypeByName[normalizeLookupKey(displayText)];
  if (byDisplay) return byDisplay;
  return null;
}

function dedupeKeyForSkill(skillId: number | null | undefined, text: string): string {
  if (typeof skillId === 'number') return `id:${skillId}`;
  return `txt:${normalizeLookupKey(text)}`;
}

function isRuntimeLanguageSkill(text: string): boolean {
  const normalized = normalizeLookupKey(text);
  return RUNTIME_LANGUAGE_ALLOWLIST.has(normalized);
}

function isConceptLikeSkill(text: string): boolean {
  const normalized = normalizeLookupKey(text);
  return (
    /\b(system design|microservices?|distributed systems?|distributed computing|object oriented|design patterns?|data structures?|coding fundamentals)\b/i.test(
      normalized,
    ) || NON_TECH_STACK_SKILLS.has(normalizeCaseToken(text))
  );
}

function looksLikeToolOrPlatform(text: string): boolean {
  const normalized = normalizeLookupKey(text);
  if (!normalized) return false;
  if (
    /\b(docker|kubernetes|terraform|cloudformation|jenkins|github actions|gitlab|datadog|splunk|grafana|dynatrace|fastapi|uvicorn|langchain|qdrant)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(aws|azure|gcp|google cloud platform|lambda|ecs|eks|s3|rds|dynamodb|iam|cloudwatch)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (normalized.endsWith('db') || normalized.includes('api') || normalized.includes('sdk')) return true;
  return false;
}

function dedupeBySkillKey(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeItem(item);
    if (!normalized) continue;
    const key = dedupeKeyForSkill(null, normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function isSoftOrGenericSkill(skill: string): boolean {
  const normalized = normalizeCaseToken(skill);
  if (SOFT_OR_GENERIC_SKILLS.has(normalized)) return true;
  return /\b(communication|leadership|problem solving|collaboration|teamwork|ownership|stakeholder)\b/i.test(
    skill,
  );
}

function normalizeCaseToken(text: string): string {
  if (!text) return '';
  const specialTokenMap: Record<string, string> = {
    APIS: 'APIs',
    GENAI: 'GenAI',
    JAVASCRIPT: 'JavaScript',
    TYPESCRIPT: 'TypeScript',
    FASTAPI: 'FastAPI',
  };
  const upperAcronyms = new Set(['API', 'APIS', 'REST', 'CI', 'CD', 'AWS', 'J2EE', 'MQ', 'SQL', 'NOSQL', 'LLM', 'LLMS', 'GENAI']);
  return text
    .split(' ')
    .map((part) => {
      const raw = part.trim();
      if (!raw) return raw;
      const key = raw.toUpperCase();
      if (specialTokenMap[key]) return specialTokenMap[key];
      if (/^[a-z]{1,4}\/[a-z]{1,4}$/i.test(raw)) return raw.toUpperCase();
      if (upperAcronyms.has(key)) return key;
      if (/[0-9]/.test(raw) && raw.length <= 6) return raw.toUpperCase();
      return raw[0].toUpperCase() + raw.slice(1).toLowerCase();
    })
    .join(' ');
}

function dedupeStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = normalizeItem(item);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function isLikelySkillPhrase(raw: string): boolean {
  const text = normalizeItem(raw);
  if (!text) return false;
  if (text.length < 2 || text.length > 48) return false;
  if (/[?:!]/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 4) return false;
  if (!/[a-z]/i.test(text)) return false;

  const forbidden = /\b(what|you|your|will|need|succeed|title|about|role|opportunity|responsibilit|qualification|required|preferred|must|nice)\b/i;
  if (forbidden.test(text)) return false;
  return true;
}

function normalizeSkillInput(input: string[], strict = false): string[] {
  const out: string[] = [];
  for (const rawItem of input) {
    const raw = String(rawItem || '').trim();
    if (!raw) continue;
    const known = extractKnownSkillsFromLine(raw.toLowerCase());
    if (known.length > 0) {
      out.push(...known);
      continue;
    }
    if (strict && !isLikelySkillPhrase(raw)) continue;
    out.push(normalizeCaseToken(cleanupSkillChunk(raw)));
  }
  return dedupeStrings(out);
}

export function normalizeSkills(
  input: string[],
  context: { jdText: string; roleTitle?: string; strict?: boolean } = { jdText: '' },
): string[] {
  void context;
  return normalizeSkillInput(input, Boolean(context.strict));
}

function capStrings(list: string[], max: number): string[] {
  return list.slice(0, max);
}

function clampPercent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function cleanupSkillChunk(raw: string): string {
  return String(raw || '')
    .replace(/^[\s\-*•:]+/g, '')
    .replace(
      /^(solid|strong|good|hands-on)?\s*(professional\s+)?(working\s+knowledge\s+of|knowledge\s+of|experience\s+with|experience\s+in|understanding\s+of|proficiency\s+in|ability\s+to)\s+/i,
      '',
    )
    .replace(/\b(such as|like)\b/gi, '')
    .replace(/\b(on any major cloud provider|practices and frameworks|methodologies)\b/gi, '')
    .replace(/[().]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractKnownSkillsFromLine(line: string): string[] {
  const matches: Array<{ idx: number; label: string }> = [];
  for (const [re, label] of JD_SKILL_PATTERNS) {
    const m = line.match(re);
    if (!m || typeof m.index !== 'number') continue;
    matches.push({ idx: m.index, label });
  }
  return dedupeStrings(
    matches
      .sort((a, b) => a.idx - b.idx)
      .map((m) => m.label),
  );
}

function extractSkillSignalsFromJdText(jdText: string): {
  must: string[];
  nice: string[];
  tech: string[];
  all: string[];
  sectionBySkill: Record<string, SkillEvidenceSection>;
} {
  const lines = String(jdText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { must: [], nice: [], tech: [], all: [], sectionBySkill: {} };

  const mustSet = new Set<string>();
  const niceSet = new Set<string>();
  const techSet = new Set<string>();
  const allSet = new Set<string>();
  const sectionBySkill: Record<string, SkillEvidenceSection> = {};

  let section: SkillEvidenceSection = 'neutral';
  const mustPattern =
    /\b(must[-\s]*have|required|minimum qualifications|required qualifications|requirements|what you'll need|must[-\s]*required)\b/i;
  const nicePattern =
    /\b(nice[-\s]*to[-\s]*have|preferred|preferred qualifications|good[-\s]*to[-\s]*have|plus|bonus)\b/i;
  const sectionHeaderOnlyPattern =
    /^\s*(must[-\s]*have skills?|nice[-\s]*to[-\s]*have skills?|required qualifications?|preferred qualifications?|what you'll need to succeed|tech stack|tools?|environment)\s*:?\s*$/i;
  const sectionPriority: Record<SkillEvidenceSection, number> = {
    neutral: 0,
    nice: 1,
    must: 2,
    tech: 3,
  };

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    if (mustPattern.test(lowerLine) && !nicePattern.test(lowerLine)) {
      section = 'must';
    } else if (nicePattern.test(lowerLine)) {
      section = 'nice';
    } else if (STACK_SECTION_PATTERN.test(lowerLine)) {
      section = 'tech';
    }

    if (sectionHeaderOnlyPattern.test(lowerLine)) {
      continue;
    }
    const candidates = extractKnownSkillsFromLine(lowerLine);
    for (const skill of candidates) {
      allSet.add(skill);
      const previous = sectionBySkill[skill] || 'neutral';
      let current: SkillEvidenceSection = 'neutral';
      if (nicePattern.test(lowerLine)) {
        niceSet.add(skill);
        current = 'nice';
      } else if (mustPattern.test(lowerLine)) {
        mustSet.add(skill);
        current = 'must';
      } else if (STACK_SECTION_PATTERN.test(lowerLine)) {
        techSet.add(skill);
        current = 'tech';
      } else if (section === 'must') {
        mustSet.add(skill);
        current = 'must';
      } else if (section === 'nice') {
        niceSet.add(skill);
        current = 'nice';
      } else if (section === 'tech') {
        techSet.add(skill);
        current = 'tech';
      }
      if (sectionPriority[current] >= sectionPriority[previous]) {
        sectionBySkill[skill] = current;
      }
    }
  }

  for (const skill of Array.from(mustSet)) {
    if (niceSet.has(skill)) {
      niceSet.delete(skill);
    }
  }

  return {
    must: normalizeSkills(Array.from(mustSet), { jdText: '', strict: true }),
    nice: normalizeSkills(Array.from(niceSet), { jdText: '', strict: true }),
    tech: normalizeSkills(Array.from(techSet), { jdText: '', strict: true }),
    all: normalizeSkills(Array.from(allSet), { jdText: '', strict: true }),
    sectionBySkill,
  };
}

function normalizeSkillCalibration(
  input: SkillCalibrationItem[] | undefined,
  mustHaves: string[],
  niceToHaves: string[],
): SkillCalibrationItem[] {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: SkillCalibrationItem[] = [];

  for (const row of rows) {
    const skill = normalizeItem(String(row?.skill || ''));
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const category = row?.category === 'nice_to_have' ? 'nice_to_have' : 'must_have';
    out.push({
      skill,
      category,
      definition: String(row?.definition || '').trim().slice(0, 260),
      weight_percent: clampPercent(row?.weight_percent, category === 'must_have' ? 60 : 20),
    });
  }

  for (const skill of mustHaves) {
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      skill,
      category: 'must_have',
      definition: '',
      weight_percent: 60,
    });
  }
  for (const skill of niceToHaves) {
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      skill,
      category: 'nice_to_have',
      definition: '',
      weight_percent: 20,
    });
  }

  return out.slice(0, 20);
}

function isTechStackSkill(candidate: TechStackCandidate): boolean {
  const s = normalizeItem(candidate.displayText);
  if (!s) return false;
  if (NON_TECH_STACK_SKILLS.has(s)) return false;

  const evidenceSection = candidate.evidenceSection || candidate.sourceSection || 'neutral';
  const effectiveSkillType = normalizeSkillType(candidate.skillType);

  if (effectiveSkillType) {
    if (TECH_STACK_TYPES.has(effectiveSkillType)) return true;
    if (effectiveSkillType === 'language') {
      return isRuntimeLanguageSkill(candidate.canonicalName || s) || evidenceSection === 'tech';
    }
    return false;
  }

  if (isConceptLikeSkill(s)) return false;
  return looksLikeToolOrPlatform(s);
}

function buildTechStackMeta(
  techStack: string[],
  mustHaves: string[],
  niceToHaves: string[],
): TechStackMetaItem[] {
  const mustSet = new Set(mustHaves.map((skill) => dedupeKeyForSkill(null, skill)));
  const niceSet = new Set(niceToHaves.map((skill) => dedupeKeyForSkill(null, skill)));
  return techStack.map((skill) => {
    const key = dedupeKeyForSkill(null, skill);
    return {
      skill,
      alsoInMustHave: mustSet.has(key),
      alsoInNiceToHave: niceSet.has(key),
    };
  });
}

function normalizeFocusAreas(values: string[]): PositionConfigCore['focus_areas'] {
  const out = dedupeStrings(values.map((v) => v.toLowerCase().replace(/\s+/g, '_'))).filter((v): v is PositionConfigCore['focus_areas'][number] =>
    isOneOf(v, FOCUS_AREAS),
  );
  return capStrings(out, 4);
}

export function normalizeAndMap(
  extraction: PositionExtraction,
  opts: { jdText: string; roleTitleOverride?: string; skillTypeByName?: Record<string, string> } = { jdText: '' },
): {
  prefill: PositionConfigCore;
  missingFields: string[];
  warnings: string[];
  confidence: number;
} {
  const missing = new Set<string>(extraction.missing_fields || []);
  const warnings: string[] = [];

  let level: PositionConfigCore['level'] = 'mid';
  const normalizedLevel = String(extraction.level || '').trim().toLowerCase();
  const levelConf = clamp01(extraction.confidence?.level, 0);
  if (isOneOf(normalizedLevel, LEVELS) && levelConf >= 0.6) {
    level = normalizedLevel;
  } else {
    missing.add('level');
    warnings.push('Level defaulted to mid.');
  }

  const requestedDuration = Number(extraction.recommended_duration_minutes || 0);
  const mappedDuration = isOneOf(requestedDuration, DURATIONS) ? requestedDuration : DEFAULT_DURATION;

  const jdSignals = extractSkillSignalsFromJdText(opts.jdText);
  const hasExplicitJdSections = jdSignals.must.length > 0 || jdSignals.nice.length > 0;
  const extractedMust = normalizeSkills(extraction.must_haves || [], {
    jdText: opts.jdText,
    roleTitle: opts.roleTitleOverride || extraction.role_title,
    strict: true,
  });
  const extractedNice = normalizeSkills(extraction.nice_to_haves || [], {
    jdText: opts.jdText,
    roleTitle: opts.roleTitleOverride || extraction.role_title,
    strict: true,
  });
  const jdSignalSkills = normalizeSkills(jdSignals.all, {
    jdText: opts.jdText,
    roleTitle: opts.roleTitleOverride || extraction.role_title,
    strict: true,
  });
  const jdMustSignals = normalizeSkills(jdSignals.must, {
    jdText: opts.jdText,
    roleTitle: opts.roleTitleOverride || extraction.role_title,
    strict: true,
  });
  const jdNiceSignals = normalizeSkills(jdSignals.nice, {
    jdText: opts.jdText,
    roleTitle: opts.roleTitleOverride || extraction.role_title,
    strict: true,
  });
  const mustSeed = hasExplicitJdSections
    ? [...jdMustSignals, ...extractedMust, ...jdSignalSkills]
    : [...extractedMust, ...jdSignalSkills];
  const preliminaryMust = capStrings(dedupeBySkillKey(mustSeed), 8);
  const hardMust = preliminaryMust.filter((skill) => !isSoftOrGenericSkill(skill));
  const softMust = preliminaryMust.filter((skill) => isSoftOrGenericSkill(skill));
  const hardPool = dedupeBySkillKey([
    ...hardMust,
    ...normalizeSkills(extraction.tech_stack || [], { jdText: opts.jdText, strict: true }),
    ...jdMustSignals,
    ...jdSignalSkills,
  ]).filter((skill) => !isSoftOrGenericSkill(skill));
  const mustRebalanced: string[] = [];
  for (const skill of hardPool) {
    if (mustRebalanced.includes(skill)) continue;
    mustRebalanced.push(skill);
    if (mustRebalanced.length >= 8) break;
  }
  const hardTarget = Math.min(5, preliminaryMust.length);
  const maxSoft = mustRebalanced.length >= hardTarget ? 1 : Math.max(2, 8 - mustRebalanced.length);
  for (const skill of softMust) {
    if (mustRebalanced.includes(skill)) continue;
    const currentSoft = mustRebalanced.filter((item) => isSoftOrGenericSkill(item)).length;
    if (currentSoft >= maxSoft) break;
    mustRebalanced.push(skill);
    if (mustRebalanced.length >= 8) break;
  }
  const mustHaves = capStrings(dedupeBySkillKey(mustRebalanced), 8);
  if (mustHaves.length < 1) {
    missing.add('must_haves');
    warnings.push('Must-haves could not be extracted from JD.');
  }

  const mustSet = new Set(mustHaves.map((x) => normalizeLookupKey(x)));
  const niceToHavesSeed = hasExplicitJdSections
    ? [...jdNiceSignals, ...extractedNice]
    : [...extractedNice, ...jdSignalSkills.filter((skill) => !mustSet.has(normalizeLookupKey(skill)))];
  const niceToHaves = capStrings(dedupeBySkillKey(niceToHavesSeed), 8);
  const techCandidates: TechStackCandidate[] = [
    ...normalizeSkills(extraction.tech_stack || [], { jdText: opts.jdText, strict: true }).map((skill) => ({
      displayText: skill,
      canonicalName: skill,
      skillType: resolveSkillTypeFromMap(opts.skillTypeByName, skill, skill),
      evidenceSection: 'tech' as const,
      sourceSection: 'tech' as const,
    })),
    ...jdSignalSkills
      .filter((skill) => !mustSet.has(normalizeLookupKey(skill)))
      .map((skill) => ({
        displayText: skill,
        canonicalName: skill,
        skillType: resolveSkillTypeFromMap(opts.skillTypeByName, skill, skill),
        evidenceSection: jdSignals.sectionBySkill[skill] || 'neutral',
      })),
    ...mustHaves.map((skill) => ({
      displayText: skill,
      canonicalName: skill,
      skillType: resolveSkillTypeFromMap(opts.skillTypeByName, skill, skill),
      evidenceSection: jdSignals.sectionBySkill[skill] || 'must',
      sourceSection: 'must' as const,
    })),
    ...normalizeSkills(jdSignals.tech, { jdText: opts.jdText, strict: true }).map((skill) => ({
      displayText: skill,
      canonicalName: skill,
      skillType: resolveSkillTypeFromMap(opts.skillTypeByName, skill, skill),
      evidenceSection: 'tech' as const,
    })),
  ];
  const techStackSeen = new Set<string>();
  const techStack: string[] = [];
  for (const candidate of techCandidates) {
    if (!isTechStackSkill(candidate)) continue;
    const displayText = normalizeItem(candidate.canonicalName || candidate.displayText);
    if (!displayText) continue;
    const key = dedupeKeyForSkill(candidate.skillId, displayText);
    if (techStackSeen.has(key)) continue;
    techStackSeen.add(key);
    techStack.push(displayText);
    if (techStack.length >= 15) break;
  }
  const techStackMeta = buildTechStackMeta(techStack, mustHaves, niceToHaves);
  const deepDiveMode = isOneOf(extraction.deep_dive_mode, DEEP_DIVE_MODES) ? extraction.deep_dive_mode : 'none';
  const strictness = isOneOf(extraction.strictness, STRICTNESS_LEVELS) ? extraction.strictness : 'balanced';
  const evaluationPolicy = isOneOf(extraction.evaluation_policy, EVALUATION_POLICIES)
    ? extraction.evaluation_policy
    : 'holistic';

  const notes = String(extraction.notes_for_interviewer || '').trim().slice(0, 600);
  const mustHaveConf = clamp01(extraction.confidence?.must_haves, 0.4);
  const techStackConf = clamp01(extraction.confidence?.tech_stack, 0.4);
  const reportedOverall = clamp01(extraction.confidence?.overall, 0);
  const inferredOverall = clamp01((levelConf + mustHaveConf + techStackConf) / 3, 0.45);
  const confidence = reportedOverall >= 0.1 ? reportedOverall : inferredOverall;

  return {
    prefill: {
      role_title: (opts.roleTitleOverride || extraction.role_title || 'Untitled Position').trim(),
      level,
      duration_minutes: mappedDuration,
      must_haves: mustHaves,
      nice_to_haves: niceToHaves,
      tech_stack: techStack,
      tech_stack_meta: techStackMeta,
      focus_areas: normalizeFocusAreas(extraction.focus_areas || []),
      deep_dive_mode: deepDiveMode,
      strictness,
      evaluation_policy: evaluationPolicy,
      notes_for_interviewer: notes,
      skills_calibration: normalizeSkillCalibration([], mustHaves, niceToHaves),
    },
    missingFields: Array.from(missing),
    warnings,
    confidence,
  };
}

export function applyDeterministicMapping(
  config: PositionConfigCore,
  opts: { skillTypeByName?: Record<string, string> } = {},
): PositionConfigCore {
  const duration = isOneOf(config.duration_minutes, DURATIONS) ? config.duration_minutes : DEFAULT_DURATION;

  const mustHaves = capStrings(dedupeBySkillKey(normalizeSkills(config.must_haves)), 8);
  const niceToHaves = capStrings(dedupeBySkillKey(normalizeSkills(config.nice_to_haves)), 8);
  const effectiveMustHaves = mustHaves;
  const effectiveNiceToHaves = niceToHaves;
  const normalizedTechCandidates = normalizeSkills(config.tech_stack).map((skill) => ({
    displayText: skill,
    canonicalName: skill,
    skillType: resolveSkillTypeFromMap(opts.skillTypeByName, skill, skill),
    evidenceSection: 'tech' as const,
    sourceSection: 'tech' as const,
  }));
  const normalizedTechStack = capStrings(
    dedupeBySkillKey(
      normalizedTechCandidates
        .filter((candidate) => isTechStackSkill(candidate))
        .map((candidate) => normalizeItem(candidate.canonicalName || candidate.displayText))
        .filter(Boolean),
    ),
    15,
  );

  return {
    ...config,
    duration_minutes: duration,
    must_haves: effectiveMustHaves,
    nice_to_haves: effectiveNiceToHaves,
    tech_stack: normalizedTechStack,
    tech_stack_meta: buildTechStackMeta(normalizedTechStack, effectiveMustHaves, effectiveNiceToHaves),
    focus_areas: capStrings(config.focus_areas.filter((f): f is PositionConfigCore['focus_areas'][number] => isOneOf(f, FOCUS_AREAS)), 4),
    notes_for_interviewer: String(config.notes_for_interviewer || '').slice(0, 600),
    skills_calibration: normalizeSkillCalibration(
      config.skills_calibration,
      effectiveMustHaves,
      effectiveNiceToHaves,
    ),
  };
}

export function deepDiff(base: unknown, updated: unknown): unknown {
  if (Object.is(base, updated)) return undefined;

  if (Array.isArray(base) && Array.isArray(updated)) {
    if (JSON.stringify(base) === JSON.stringify(updated)) return undefined;
    return { before: base, after: updated };
  }

  if (
    base &&
    updated &&
    typeof base === 'object' &&
    typeof updated === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(updated)
  ) {
    const out: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base as Record<string, unknown>), ...Object.keys(updated as Record<string, unknown>)]);
    for (const key of keys) {
      const diff = deepDiff((base as Record<string, unknown>)[key], (updated as Record<string, unknown>)[key]);
      if (diff !== undefined) out[key] = diff;
    }
    return Object.keys(out).length ? out : undefined;
  }

  return { before: base, after: updated };
}
