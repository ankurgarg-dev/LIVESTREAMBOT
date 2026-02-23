import roleTemplates from '../../master_data/role_templates.json';
import commonSkillTags from '../../master_data/common_skill_tags.json';
import {
  ARCHETYPES,
  DEEP_DIVE_MODES,
  DURATIONS,
  EVALUATION_POLICIES,
  FOCUS_AREAS,
  INTERVIEW_ROUND_TYPES,
  LEVELS,
  ROLE_FAMILIES,
  STRICTNESS_LEVELS,
  type PositionConfigCore,
  type PositionExtraction,
  type RoleFamily,
  type Level,
  type SkillCalibrationItem,
} from './types';

type SkillTagAlias = { canonical: string; aliases: string[] };

type RoleTemplateEntry = {
  archetype_id: string;
  duration_minutes: number;
  must_haves: string[];
  tech_stack?: string[];
};

type RoleTemplateMap = {
  default: RoleTemplateEntry;
  [roleFamily: string]: RoleTemplateEntry | Record<string, RoleTemplateEntry>;
};

const templates = roleTemplates as RoleTemplateMap;
const skillAliases = commonSkillTags as SkillTagAlias[];

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
    'role_family',
    'level',
    'interview_round_type',
    'recommended_archetype_id',
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
  if (typeof p.role_family !== 'string') errors.push('role_family must be string');
  if (typeof p.level !== 'string') errors.push('level must be string');
  if (typeof p.interview_round_type !== 'string') errors.push('interview_round_type must be string');
  if (typeof p.recommended_archetype_id !== 'string') errors.push('recommended_archetype_id must be string');
  if (typeof p.recommended_duration_minutes !== 'number') errors.push('recommended_duration_minutes must be number');
  if (typeof p.deep_dive_mode !== 'string') errors.push('deep_dive_mode must be string');
  if (typeof p.strictness !== 'string') errors.push('strictness must be string');
  if (typeof p.evaluation_policy !== 'string') errors.push('evaluation_policy must be string');
  if (typeof p.notes_for_interviewer !== 'string') errors.push('notes_for_interviewer must be string');

  const conf = p.confidence as Record<string, unknown>;
  if (!conf || typeof conf !== 'object') {
    errors.push('confidence must be object');
  } else {
    for (const key of ['role_family', 'level', 'must_haves', 'tech_stack', 'overall']) {
      const v = conf[key];
      if (typeof v !== 'number' || v < 0 || v > 1) errors.push(`confidence.${key} must be number 0..1`);
    }
  }

  const rationale = p.extraction_rationale as Record<string, unknown>;
  if (!rationale || typeof rationale !== 'object') {
    errors.push('extraction_rationale must be object');
  } else {
    if (typeof rationale.role_family !== 'string') errors.push('extraction_rationale.role_family must be string');
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

function normalizeCaseToken(text: string): string {
  if (!text) return '';
  return text
    .split(' ')
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()))
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

export function normalizeSkills(
  input: string[],
  context: { jdText: string; roleTitle?: string } = { jdText: '' },
): string[] {
  const normalized = dedupeStrings(input).map(normalizeCaseToken);
  const jdLower = `${context.jdText} ${context.roleTitle || ''}`.toLowerCase();

  return dedupeStrings(
    normalized.map((skill) => {
      const lower = skill.toLowerCase();
      for (const alias of skillAliases) {
        if (alias.canonical.toLowerCase() === lower) return alias.canonical;
        if (alias.aliases.some((candidate) => candidate.toLowerCase() === lower)) {
          if (alias.canonical === 'Spring Boot') {
            if (jdLower.includes('boot') || jdLower.includes('spring boot')) return 'Spring Boot';
            return 'Spring';
          }
          return alias.canonical;
        }
      }
      if (lower === 'js') return 'JavaScript';
      if (lower === 'ts') return 'TypeScript';
      return skill;
    }),
  );
}

export function getTemplate(roleFamily: RoleFamily, level: Level): RoleTemplateEntry {
  const byFamily = templates[roleFamily] as Record<string, RoleTemplateEntry> | undefined;
  if (byFamily && byFamily[level]) return byFamily[level];
  return templates.default;
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

function extractSkillsFromJdText(jdText: string): string[] {
  const lowered = String(jdText || '').toLowerCase();
  if (!lowered) return [];
  const out: string[] = [];
  for (const alias of skillAliases) {
    const candidates = [alias.canonical, ...(alias.aliases || [])].map((v) => String(v || '').toLowerCase()).filter(Boolean);
    if (candidates.some((candidate) => lowered.includes(candidate))) {
      out.push(alias.canonical);
    }
  }
  return dedupeStrings(out);
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

function normalizeFocusAreas(values: string[]): PositionConfigCore['focus_areas'] {
  const out = dedupeStrings(values.map((v) => v.toLowerCase().replace(/\s+/g, '_'))).filter((v): v is PositionConfigCore['focus_areas'][number] =>
    isOneOf(v, FOCUS_AREAS),
  );
  return capStrings(out, 4);
}

export function normalizeAndMap(
  extraction: PositionExtraction,
  opts: { jdText: string; roleTitleOverride?: string } = { jdText: '' },
): {
  prefill: PositionConfigCore;
  missingFields: string[];
  warnings: string[];
  confidence: number;
} {
  const missing = new Set<string>(extraction.missing_fields || []);
  const warnings: string[] = [];

  let roleFamily: RoleFamily = 'full_stack';
  const normalizedRole = String(extraction.role_family || '').trim().toLowerCase();
  const roleConf = clamp01(extraction.confidence?.role_family, 0);
  if (isOneOf(normalizedRole, ROLE_FAMILIES) && roleConf >= 0.6) {
    roleFamily = normalizedRole;
  } else {
    missing.add('role_family');
    warnings.push('Role family defaulted to full_stack.');
  }

  let level: Level = 'mid';
  const normalizedLevel = String(extraction.level || '').trim().toLowerCase();
  const levelConf = clamp01(extraction.confidence?.level, 0);
  if (isOneOf(normalizedLevel, LEVELS) && levelConf >= 0.6) {
    level = normalizedLevel;
  } else {
    missing.add('level');
    warnings.push('Level defaulted to mid.');
  }

  const template = getTemplate(roleFamily, level);
  const mappedArchetype = isOneOf(template.archetype_id, ARCHETYPES)
    ? template.archetype_id
    : templates.default.archetype_id;
  const mappedDuration = isOneOf(template.duration_minutes, DURATIONS)
    ? template.duration_minutes
    : templates.default.duration_minutes;

  const mustHavesNorm = normalizeSkills(extraction.must_haves || [], {
    jdText: opts.jdText,
    roleTitle: opts.roleTitleOverride || extraction.role_title,
  });
  const jdSignalSkills = normalizeSkills(
    [...extractSkillsFromJdText(opts.jdText), ...(extraction.tech_stack || [])],
    { jdText: opts.jdText, roleTitle: opts.roleTitleOverride || extraction.role_title },
  );
  const mustHavesSeed = dedupeStrings([...mustHavesNorm, ...jdSignalSkills]);
  const backfill = normalizeSkills(template.must_haves || [], { jdText: opts.jdText });
  const mustHaves = capStrings(
    mustHavesSeed.length >= 3 ? mustHavesSeed : dedupeStrings([...mustHavesSeed, ...backfill]),
    8,
  );
  if (mustHaves.length < 3) {
    missing.add('must_haves');
    warnings.push('Must-haves backfilled from template.');
  }

  const mustSet = new Set(mustHaves.map((x) => x.toLowerCase()));
  const niceToHavesSeed = dedupeStrings([
    ...normalizeSkills(extraction.nice_to_haves || [], { jdText: opts.jdText }),
    ...jdSignalSkills.filter((skill) => !mustSet.has(skill.toLowerCase())),
  ]);
  const niceToHaves = capStrings(niceToHavesSeed, 8);
  const techStack = capStrings(normalizeSkills(extraction.tech_stack || template.tech_stack || [], { jdText: opts.jdText }), 15);

  const interviewRoundType = isOneOf(extraction.interview_round_type, INTERVIEW_ROUND_TYPES)
    ? extraction.interview_round_type
    : 'standard';
  const deepDiveMode = isOneOf(extraction.deep_dive_mode, DEEP_DIVE_MODES) ? extraction.deep_dive_mode : 'none';
  const strictness = isOneOf(extraction.strictness, STRICTNESS_LEVELS) ? extraction.strictness : 'balanced';
  const evaluationPolicy = isOneOf(extraction.evaluation_policy, EVALUATION_POLICIES)
    ? extraction.evaluation_policy
    : 'holistic';

  const notes = String(extraction.notes_for_interviewer || '').trim().slice(0, 600);
  const mustHaveConf = clamp01(extraction.confidence?.must_haves, 0.4);
  const techStackConf = clamp01(extraction.confidence?.tech_stack, 0.4);
  const reportedOverall = clamp01(extraction.confidence?.overall, 0);
  const inferredOverall = clamp01((roleConf + levelConf + mustHaveConf + techStackConf) / 4, 0.45);
  const confidence = reportedOverall >= 0.1 ? reportedOverall : inferredOverall;

  return {
    prefill: {
      role_title: (opts.roleTitleOverride || extraction.role_title || 'Untitled Position').trim(),
      role_family: roleFamily,
      level,
      interview_round_type: interviewRoundType,
      archetype_id: mappedArchetype,
      duration_minutes: mappedDuration,
      must_haves: mustHaves,
      nice_to_haves: niceToHaves,
      tech_stack: techStack,
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

export function applyDeterministicMapping(config: PositionConfigCore): PositionConfigCore {
  const template = getTemplate(config.role_family, config.level);
  const archetype = isOneOf(template.archetype_id, ARCHETYPES)
    ? template.archetype_id
    : config.archetype_id;
  const duration = isOneOf(template.duration_minutes, DURATIONS)
    ? template.duration_minutes
    : config.duration_minutes;

  const mustHaves = capStrings(dedupeStrings(normalizeSkills(config.must_haves)), 8);
  const niceToHaves = capStrings(normalizeSkills(config.nice_to_haves), 8);
  const effectiveMustHaves =
    mustHaves.length >= 1 ? mustHaves : capStrings(dedupeStrings(normalizeSkills(template.must_haves)), 8);
  const effectiveNiceToHaves = niceToHaves;

  return {
    ...config,
    archetype_id: archetype,
    duration_minutes: duration,
    must_haves: effectiveMustHaves,
    nice_to_haves: effectiveNiceToHaves,
    tech_stack: capStrings(normalizeSkills(config.tech_stack), 15),
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
