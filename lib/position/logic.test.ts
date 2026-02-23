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
    level: 'senior',
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
      level: 0.9,
      must_haves: 0.9,
      tech_stack: 0.8,
      overall: 0.85,
    },
    missing_fields: [],
    extraction_rationale: {
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
  it('normalizes casing and dedupes', () => {
    const out = normalizeSkills(['java', ' Java ', 'j2ee', 'REST APIs']);
    expect(out).toContain('Java');
    expect(out).toContain('J2EE');
    expect(out).toContain('REST APIs');
    expect(out.filter((v) => v === 'Java').length).toBe(1);
  });
});

describe('normalizeAndMap', () => {
  it('uses extracted duration when valid', () => {
    const res = normalizeAndMap(sampleExtraction(), { jdText: 'backend services' });
    expect(res.prefill.duration_minutes).toBe(60);
  });

  it('defaults low confidence level', () => {
    const res = normalizeAndMap(
      sampleExtraction({ level: 'unknown', confidence: { level: 0.2, must_haves: 0.8, tech_stack: 0.8, overall: 0.4 } }),
      { jdText: '' },
    );
    expect(res.prefill.level).toBe('mid');
    expect(res.missingFields).toContain('level');
  });

  it('uses JD required/preferred sections to split must and nice skills', () => {
    const jdText = `
Required Qualifications
- 7+ years building Java and Spring Boot microservices
- Strong AWS and Kafka experience

Preferred Qualifications
- Exposure to Kubernetes and Terraform
`;
    const res = normalizeAndMap(
      sampleExtraction({
        must_haves: [],
        nice_to_haves: [],
        tech_stack: [],
      }),
      { jdText },
    );

    expect(res.prefill.must_haves).toEqual(expect.arrayContaining(['Java', 'Spring Boot', 'Microservices', 'AWS', 'Kafka']));
    expect(res.prefill.nice_to_haves).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
  });

  it('keeps GenAI in nice-to-have when JD marks it as nice to have', () => {
    const jdText = `
Must Have Skills:
- Solid professional coding experience in Java/J2EE technologies.
- Strong working knowledge of microservices, RESTful APIs, NoSQL databases and MQ (or) Kafka.
- Good working knowledge of IaC tools such as Terraform on any major cloud provider.
- Experience with continuous integration/delivery/deployment (CI/CD).
- Strong working knowledge of containerization technologies like Docker and Kubernetes.

Nice to have skills:
- Knowledge and understanding of GenAI technologies.
`;
    const res = normalizeAndMap(
      sampleExtraction({
        must_haves: ['AWS', 'Kubernetes', 'Docker', 'MLOps', 'LLMs', 'Agentic AI', 'Technical Leadership', 'Problem Solving'],
        nice_to_haves: [],
      }),
      { jdText },
    );

    expect(res.prefill.must_haves).not.toEqual(expect.arrayContaining(['LLMs', 'MLOps', 'GENAI']));
    expect(res.prefill.nice_to_haves).toEqual(expect.arrayContaining(['GenAI']));
  });

  it('filters out JD prose/header fragments and keeps only skills', () => {
    const jdText = `
Title: Senior Software Engineer ESS Ascend Platform
About the Role:
What You'll Need To Succeed:
- Strong Java/J2EE coding skills with object-oriented design and design patterns.
- Experience with microservices.

Nice to have skills:
- Knowledge and understanding of GenAI technologies.
`;
    const res = normalizeAndMap(
      sampleExtraction({
        must_haves: ['What You\'ll Need To Succeed', 'Java', 'Title:', 'About The Role:'],
        nice_to_haves: ['Senior Software Engineer Ess Ascend Platform', 'You Will Have Opportunity To Use Your Expertise', 'GENAI'],
      }),
      { jdText },
    );

    expect(res.prefill.must_haves).toEqual(
      expect.arrayContaining(['Java', 'J2EE', 'Object-Oriented Design', 'Design Patterns', 'Microservices']),
    );
    expect(res.prefill.must_haves).not.toEqual(
      expect.arrayContaining(['What You\'ll Need To Succeed', 'Title:', 'About The Role:']),
    );
    expect(res.prefill.nice_to_haves).toEqual(expect.arrayContaining(['GenAI']));
    expect(res.prefill.nice_to_haves).not.toEqual(
      expect.arrayContaining(['Senior Software Engineer Ess Ascend Platform', 'You Will Have Opportunity To Use Your Expertise']),
    );
  });

  it('prioritizes must-have ordering from JD required section', () => {
    const jdText = `
Required Qualifications
- Strong Java/J2EE fundamentals with object-oriented design and design patterns
- Experience building microservices and REST APIs
- Hands-on Docker, Kubernetes, and AWS
`;
    const res = normalizeAndMap(
      sampleExtraction({
        must_haves: ['AWS', 'Docker', 'Kubernetes', 'Java'],
        nice_to_haves: [],
      }),
      { jdText },
    );

    expect(res.prefill.must_haves.slice(0, 4)).toEqual(['Java', 'J2EE', 'Object-Oriented Design', 'Design Patterns']);
  });

  it('derives tech stack from JD when extraction tech stack is empty', () => {
    const jdText = `
Required Qualifications
- Strong Java/J2EE fundamentals with microservices and REST APIs
- Hands-on Docker, Kubernetes, AWS, Kafka, and Terraform
`;
    const res = normalizeAndMap(
      sampleExtraction({
        must_haves: [],
        nice_to_haves: [],
        tech_stack: [],
      }),
      { jdText },
    );
    expect(res.prefill.tech_stack).toEqual(
      expect.arrayContaining(['Java', 'J2EE', 'Microservices', 'REST APIs', 'Docker', 'Kubernetes', 'AWS', 'Kafka', 'Terraform']),
    );
  });
});

describe('applyDeterministicMapping', () => {
  it('keeps valid duration and normalizes skills', () => {
    const updated = applyDeterministicMapping({
      role_title: 'x',
      level: 'junior',
      duration_minutes: 45,
      must_haves: ['React'],
      nice_to_haves: [],
      tech_stack: [],
      focus_areas: ['coding'],
      deep_dive_mode: 'none',
      strictness: 'balanced',
      evaluation_policy: 'holistic',
      notes_for_interviewer: '',
    });

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
