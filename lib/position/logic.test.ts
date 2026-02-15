import { describe, expect, it } from 'vitest';
import {
  applyDeterministicMapping,
  deepDiff,
  normalizeAndMap,
  normalizeSkills,
  validateExtractionShape,
} from './logic';
import type { PositionExtraction } from './types';

function sampleExtraction(partial: Partial<PositionExtraction> = {}): PositionExtraction {
  return {
    role_title: 'Senior Backend Engineer',
    role_family: 'backend',
    level: 'senior',
    interview_round_type: 'deep_dive',
    recommended_archetype_id: 'backend_services',
    recommended_duration_minutes: 60,
    must_haves: ['Node', 'Distributed Systems', 'API Design'],
    nice_to_haves: ['K8s'],
    tech_stack: ['Node', 'Postgres', 'AWS'],
    focus_areas: ['coding', 'system_design'],
    deep_dive_mode: 'system_design',
    strictness: 'strict',
    evaluation_policy: 'skills_only',
    notes_for_interviewer: 'Probe architecture depth.',
    confidence: {
      role_family: 0.9,
      level: 0.9,
      must_haves: 0.9,
      tech_stack: 0.8,
      overall: 0.85,
    },
    missing_fields: [],
    extraction_rationale: {
      role_family: 'Backend focus in JD',
      level: 'Senior expectations stated',
    },
    ...partial,
  };
}

describe('validateExtractionShape', () => {
  it('accepts valid extraction payload', () => {
    const valid = validateExtractionShape(sampleExtraction());
    expect(valid.ok).toBe(true);
    expect(valid.errors).toEqual([]);
  });

  it('rejects missing required fields', () => {
    const invalid = validateExtractionShape({ role_title: 'X' });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });
});

describe('normalizeSkills', () => {
  it('normalizes aliases and dedupes', () => {
    const out = normalizeSkills(['js', ' JavaScript ', 'k8s', 'Nodejs', 'node']);
    expect(out).toContain('JavaScript');
    expect(out).toContain('Kubernetes');
    expect(out).toContain('Node.js');
    expect(out.filter((v) => v === 'JavaScript').length).toBe(1);
  });
});

describe('normalizeAndMap', () => {
  it('applies deterministic template for archetype and duration', () => {
    const res = normalizeAndMap(sampleExtraction(), { jdText: 'backend services' });
    expect(res.prefill.archetype_id).toBe('backend_services');
    expect([75, 90]).toContain(res.prefill.duration_minutes);
  });

  it('defaults low confidence role family and level', () => {
    const res = normalizeAndMap(
      sampleExtraction({ role_family: 'unknown', level: 'unknown', confidence: { role_family: 0.2, level: 0.2, must_haves: 0.8, tech_stack: 0.8, overall: 0.4 } }),
      { jdText: '' },
    );
    expect(res.prefill.role_family).toBe('full_stack');
    expect(res.prefill.level).toBe('mid');
    expect(res.missingFields).toContain('role_family');
    expect(res.missingFields).toContain('level');
  });
});

describe('applyDeterministicMapping', () => {
  it('recomputes archetype and duration when role/level changes', () => {
    const updated = applyDeterministicMapping({
      role_title: 'x',
      role_family: 'frontend',
      level: 'junior',
      interview_round_type: 'standard',
      archetype_id: 'backend_services',
      duration_minutes: 90,
      must_haves: ['React'],
      nice_to_haves: [],
      tech_stack: [],
      focus_areas: ['coding'],
      deep_dive_mode: 'none',
      strictness: 'balanced',
      evaluation_policy: 'holistic',
      notes_for_interviewer: '',
    });

    expect(updated.archetype_id).toBe('frontend_ui');
    expect(updated.duration_minutes).toBe(45);
  });
});

describe('deepDiff', () => {
  it('returns changed fields only', () => {
    const diff = deepDiff(
      { a: 1, b: { c: 2 }, d: [1, 2] },
      { a: 1, b: { c: 3 }, d: [1, 2, 3] },
    ) as Record<string, unknown>;

    expect(diff.a).toBeUndefined();
    expect(diff.b).toBeDefined();
    expect(diff.d).toBeDefined();
  });
});
