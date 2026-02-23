import levels from '../../master_data/levels.json';
import focusAreas from '../../master_data/focus_areas.json';
import durations from '../../master_data/durations.json';
import deepDiveModes from '../../master_data/deep_dive_modes.json';
import strictnessLevels from '../../master_data/strictness_levels.json';
import evaluationPolicies from '../../master_data/evaluation_policies.json';

export const LEVELS = levels as string[];
export const FOCUS_AREAS = focusAreas as string[];
export const DURATIONS = durations as number[];
export const DEEP_DIVE_MODES = deepDiveModes as string[];
export const STRICTNESS_LEVELS = strictnessLevels as string[];
export const EVALUATION_POLICIES = evaluationPolicies as string[];

export type Level = (typeof LEVELS)[number];
export type FocusArea = (typeof FOCUS_AREAS)[number];
export type DurationMinutes = (typeof DURATIONS)[number];
export type DeepDiveMode = (typeof DEEP_DIVE_MODES)[number];
export type Strictness = (typeof STRICTNESS_LEVELS)[number];
export type EvaluationPolicy = (typeof EVALUATION_POLICIES)[number];
export type SkillCategory = 'must_have' | 'nice_to_have';

export type SkillCalibrationItem = {
  skill: string;
  category: SkillCategory;
  definition: string;
  weight_percent: number;
};

export type PositionExtraction = {
  role_title: string;
  level: string;
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
    level: number;
    must_haves: number;
    tech_stack: number;
    overall: number;
  };
  missing_fields: string[];
  extraction_rationale: {
    level: string;
  };
};

export type PositionConfigCore = {
  role_title: string;
  level: Level;
  duration_minutes: DurationMinutes;
  must_haves: string[];
  nice_to_haves: string[];
  tech_stack: string[];
  focus_areas: FocusArea[];
  deep_dive_mode: DeepDiveMode;
  strictness: Strictness;
  evaluation_policy: EvaluationPolicy;
  notes_for_interviewer: string;
  skills_calibration?: SkillCalibrationItem[];
};

export type PositionConfigRecord = PositionConfigCore & {
  position_id: string;
  jd_text?: string;
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
