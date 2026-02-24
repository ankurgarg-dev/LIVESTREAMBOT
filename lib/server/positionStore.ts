import { randomUUID } from 'crypto';
import type { CanonicalSkillGroups, CanonicalSkillRef, PositionConfigCore, PositionConfigRecord } from '@/lib/position/types';
import { getPrismaClient } from '@/lib/server/prismaClient';

function sanitizePositionCore(value: unknown): PositionConfigCore {
  const typed = (value || {}) as Partial<PositionConfigCore> & {
    role_family?: unknown;
    interview_round_type?: unknown;
    archetype_id?: unknown;
  };
  return {
    role_title: String(typed.role_title || '').trim(),
    level: String(typed.level || 'mid').trim() as PositionConfigCore['level'],
    duration_minutes: Number(typed.duration_minutes || 60) as PositionConfigCore['duration_minutes'],
    must_haves: Array.isArray(typed.must_haves) ? typed.must_haves.map(String) : [],
    nice_to_haves: Array.isArray(typed.nice_to_haves) ? typed.nice_to_haves.map(String) : [],
    tech_stack: Array.isArray(typed.tech_stack) ? typed.tech_stack.map(String) : [],
    focus_areas: Array.isArray(typed.focus_areas) ? typed.focus_areas.map(String) as PositionConfigCore['focus_areas'] : [],
    deep_dive_mode: String(typed.deep_dive_mode || 'none').trim() as PositionConfigCore['deep_dive_mode'],
    strictness: String(typed.strictness || 'balanced').trim() as PositionConfigCore['strictness'],
    evaluation_policy: String(typed.evaluation_policy || 'holistic').trim() as PositionConfigCore['evaluation_policy'],
    notes_for_interviewer: String(typed.notes_for_interviewer || '').slice(0, 600),
    skills_calibration: Array.isArray(typed.skills_calibration) ? typed.skills_calibration : [],
  };
}

function sanitizeCanonicalSkillRef(value: unknown): CanonicalSkillRef | null {
  if (!value || typeof value !== 'object') return null;
  const typed = value as Partial<CanonicalSkillRef>;
  const rawText = String(typed.raw_text || '').trim();
  if (!rawText) return null;
  const skillId = Number(typed.skill_id);
  return {
    raw_text: rawText,
    skill_id: Number.isFinite(skillId) && skillId > 0 ? skillId : null,
    canonical_name: typed.canonical_name ? String(typed.canonical_name).trim() : null,
    confidence: Number.isFinite(Number(typed.confidence)) ? Number(typed.confidence) : 0,
    matched_by: String(typed.matched_by || 'custom'),
  };
}

function sanitizeCanonicalSkillList(value: unknown): CanonicalSkillRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeCanonicalSkillRef(item))
    .filter((item): item is CanonicalSkillRef => Boolean(item));
}

function sanitizeCanonicalSkillGroups(value: unknown): CanonicalSkillGroups | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const typed = value as Partial<CanonicalSkillGroups>;
  return {
    must_haves: sanitizeCanonicalSkillList(typed.must_haves),
    nice_to_haves: sanitizeCanonicalSkillList(typed.nice_to_haves),
    tech_stack: sanitizeCanonicalSkillList(typed.tech_stack),
  };
}

function clonePosition(value: unknown): PositionConfigRecord | null {
  if (!value || typeof value !== 'object') return null;
  const typed = value as PositionConfigRecord & {
    normalized_prefill?: unknown;
  };
  const finalConfig = sanitizePositionCore(typed);
  const normalizedPrefill = sanitizePositionCore(typed.normalized_prefill || typed);
  return {
    ...typed,
    ...finalConfig,
    jd_text: typeof typed.jd_text === 'string' ? typed.jd_text : '',
    canonical_skills: sanitizeCanonicalSkillGroups(typed.canonical_skills),
    normalized_prefill: normalizedPrefill,
  };
}

export async function listPositions(): Promise<PositionConfigRecord[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.position.findMany({ orderBy: { createdAt: 'desc' } });
  return rows
    .map((row: { payload: unknown }) => clonePosition(row.payload))
    .filter((item: PositionConfigRecord | null): item is PositionConfigRecord => Boolean(item));
}

export async function getPosition(id: string): Promise<PositionConfigRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.position.findUnique({ where: { id } });
  const parsed = clonePosition(row?.payload);
  return parsed ?? undefined;
}

export async function createPosition(input: {
  finalConfig: PositionConfigCore;
  normalizedPrefill: PositionConfigCore;
  canonicalSkills?: CanonicalSkillGroups;
  jdText?: string;
  rawExtraction: unknown;
  extractionConfidence: number;
  missingFields: string[];
  moderatorOverridesDiff: unknown;
  createdBy: string;
}): Promise<PositionConfigRecord> {
  const prisma = getPrismaClient();
  const now = new Date().toISOString();
  const sanitizedFinal = sanitizePositionCore(input.finalConfig);
  const sanitizedPrefill = sanitizePositionCore(input.normalizedPrefill);
  const record: PositionConfigRecord = {
    position_id: randomUUID(),
    ...sanitizedFinal,
    jd_text: String(input.jdText || '').trim(),
    canonical_skills: sanitizeCanonicalSkillGroups(input.canonicalSkills),
    extracted_from_jd_raw: input.rawExtraction,
    normalized_prefill: sanitizedPrefill,
    extraction_confidence: input.extractionConfidence,
    missing_fields: input.missingFields,
    moderator_overrides_diff: input.moderatorOverridesDiff,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    version: 1,
  };
  await prisma.position.create({
    data: {
      id: record.position_id,
      roleTitle: record.role_title,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
      payload: record,
    },
  });
  return record;
}

export async function updatePosition(
  id: string,
  input: {
    finalConfig: PositionConfigCore;
    canonicalSkills?: CanonicalSkillGroups;
    moderatorOverridesDiff: unknown;
    jdText?: string;
    extractionConfidence?: number;
    missingFields?: string[];
    updatedBy?: string;
  },
): Promise<PositionConfigRecord> {
  const prisma = getPrismaClient();
  const row = await prisma.position.findUnique({ where: { id } });
  const current = clonePosition(row?.payload);
  if (!current) throw new Error('Position not found');
  const sanitizedFinal = sanitizePositionCore(input.finalConfig);
  const next: PositionConfigRecord = {
    ...current,
    ...sanitizedFinal,
    canonical_skills: sanitizeCanonicalSkillGroups(input.canonicalSkills) ?? current.canonical_skills,
    jd_text: typeof input.jdText === 'string' ? input.jdText.trim() : current.jd_text,
    moderator_overrides_diff: input.moderatorOverridesDiff,
    extraction_confidence:
      typeof input.extractionConfidence === 'number' ? input.extractionConfidence : current.extraction_confidence,
    missing_fields: input.missingFields ?? current.missing_fields,
    created_by: input.updatedBy || current.created_by,
    updated_at: new Date().toISOString(),
    version: current.version + 1,
  };
  await prisma.position.update({
    where: { id },
    data: {
      roleTitle: next.role_title,
      updatedAt: new Date(next.updated_at),
      payload: next,
    },
  });
  return next;
}

export async function deletePosition(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  await prisma.position.delete({ where: { id } });
  return true;
}
