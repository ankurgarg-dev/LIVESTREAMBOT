import roleFamilies from '../../master_data/role_families.json';
import levels from '../../master_data/levels.json';
import archetypes from '../../master_data/archetypes.json';
import interviewRoundTypes from '../../master_data/interview_round_types.json';
import focusAreas from '../../master_data/focus_areas.json';
import durations from '../../master_data/durations.json';
import deepDiveModes from '../../master_data/deep_dive_modes.json';
import strictnessLevels from '../../master_data/strictness_levels.json';
import evaluationPolicies from '../../master_data/evaluation_policies.json';

export const ROLE_FAMILIES = roleFamilies as string[];
export const LEVELS = levels as string[];
export const ARCHETYPES = archetypes as string[];
export const INTERVIEW_ROUND_TYPES = interviewRoundTypes as string[];
export const FOCUS_AREAS = focusAreas as string[];
export const DURATIONS = durations as number[];
export const DEEP_DIVE_MODES = deepDiveModes as string[];
export const STRICTNESS_LEVELS = strictnessLevels as string[];
export const EVALUATION_POLICIES = evaluationPolicies as string[];

export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export type Level = (typeof LEVELS)[number];
export type ArchetypeId = (typeof ARCHETYPES)[number];
export type InterviewRoundType = (typeof INTERVIEW_ROUND_TYPES)[number];
export type FocusArea = (typeof FOCUS_AREAS)[number];
export type DurationMinutes = (typeof DURATIONS)[number];
export type DeepDiveMode = (typeof DEEP_DIVE_MODES)[number];
export type Strictness = (typeof STRICTNESS_LEVELS)[number];
export type EvaluationPolicy = (typeof EVALUATION_POLICIES)[number];

export type PositionExtraction = {
  role_title: string;
  role_family: string;
  level: string;
  interview_round_type: string;
  recommended_archetype_id: string;
  recommended_duration_minutes: number;
  must_haves: string[];
  nice_to_haves: string[];
  tech_stack: string[];
  focus_areas: string[];
  deep_dive_mode: string;
  strictness: string;
  evaluation_policy: string;
  notes_for_interviewer: string;
  confidence: {
    role_family: number;
    level: number;
    must_haves: number;
    tech_stack: number;
    overall: number;
  };
  missing_fields: string[];
  extraction_rationale: {
    role_family: string;
    level: string;
  };
};

export type PositionConfigCore = {
  role_title: string;
  role_family: RoleFamily;
  level: Level;
  interview_round_type: InterviewRoundType;
  archetype_id: ArchetypeId;
  duration_minutes: DurationMinutes;
  must_haves: string[];
  nice_to_haves: string[];
  tech_stack: string[];
  focus_areas: FocusArea[];
  deep_dive_mode: DeepDiveMode;
  strictness: Strictness;
  evaluation_policy: EvaluationPolicy;
  notes_for_interviewer: string;
};

export type PositionConfigRecord = PositionConfigCore & {
  position_id: string;
  extracted_from_jd_raw: unknown;
  normalized_prefill: PositionConfigCore;
  extraction_confidence: number;
  missing_fields: string[];
  moderator_overrides_diff: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
};

export type PrefillResult = {
  rawExtraction: PositionExtraction;
  normalizedPrefill: PositionConfigCore;
  extractionConfidence: number;
  missingFields: string[];
  warnings: string[];
  summary: string;
};
