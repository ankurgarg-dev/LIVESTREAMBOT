import {
  applyDeterministicMapping,
  normalizeAndMap,
  parseJsonWithFallback,
  validateExtractionShape,
} from '@/lib/position/logic';
import type {
  DeepDiveMode,
  EvaluationPolicy,
  FocusArea,
  InterviewRoundType,
  Level,
  PositionExtraction,
  PrefillResult,
  RoleFamily,
  Strictness,
} from '@/lib/position/types';

function detectRoleFamily(text: string): { value: RoleFamily; confidence: number; rationale: string } {
  const t = text.toLowerCase();
  if (/(machine learning|ml engineer|genai|llm|agentic ai|mlops)/.test(t)) {
    return { value: 'machine_learning', confidence: 0.9, rationale: 'Detected ML/GenAI/LLM/Agentic AI keywords.' };
  }
  if (/(backend|api|microservice|distributed system)/.test(t)) {
    return { value: 'backend', confidence: 0.8, rationale: 'Detected backend/service architecture keywords.' };
  }
  if (/(frontend|ui|react|web app)/.test(t)) {
    return { value: 'frontend', confidence: 0.8, rationale: 'Detected frontend/UI keywords.' };
  }
  if (/(data engineer|data platform|etl|warehouse)/.test(t)) {
    return { value: 'data', confidence: 0.75, rationale: 'Detected data platform/ETL keywords.' };
  }
  if (/(devops|sre|kubernetes|terraform|infrastructure)/.test(t)) {
    return { value: 'devops', confidence: 0.75, rationale: 'Detected DevOps/SRE keywords.' };
  }
  return { value: 'full_stack', confidence: 0.55, rationale: 'Fallback role family due to weak signal.' };
}

function detectLevel(text: string): { value: Level; confidence: number; rationale: string } {
  const t = text.toLowerCase();
  if (/(principal|staff\\+|distinguished)/.test(t)) {
    return { value: 'principal', confidence: 0.9, rationale: 'Detected principal/staff seniority keywords.' };
  }
  if (/(lead|technical leadership|tech lead|manager|own strategic initiatives)/.test(t)) {
    return { value: 'lead', confidence: 0.9, rationale: 'Detected lead/technical leadership keywords.' };
  }
  if (/(senior|5\\+ years|6\\+ years|7\\+ years)/.test(t)) {
    return { value: 'senior', confidence: 0.85, rationale: 'Detected senior experience signals.' };
  }
  if (/(junior|entry level|1\\+ years|2\\+ years)/.test(t)) {
    return { value: 'junior', confidence: 0.8, rationale: 'Detected junior experience signals.' };
  }
  return { value: 'mid', confidence: 0.6, rationale: 'Defaulted to mid level.' };
}

function inferRoundType(text: string): InterviewRoundType {
  const t = text.toLowerCase();
  if (/(deep dive|architecture|system design|production at scale)/.test(t)) return 'deep_dive';
  if (/(screening|initial screen)/.test(t)) return 'screening';
  return 'standard';
}

function inferFocusAreas(text: string): FocusArea[] {
  const t = text.toLowerCase();
  const out: FocusArea[] = [];
  if (/(system design|architecture|scalable)/.test(t)) out.push('architecture');
  if (/(mlops|deployment|monitoring|production)/.test(t)) out.push('mlops');
  if (/(genai|llm|agentic)/.test(t)) out.push('genai');
  if (/(lead|stakeholder|cross-functional|team)/.test(t)) out.push('leadership');
  if (/(cloud cost optimization|resource optimization|workload)/.test(t)) out.push('cloud_optimization');
  if (/(coding|hands-on|python|pytorch|tensorflow|scikit)/.test(t)) out.push('coding');
  return Array.from(new Set(out)).slice(0, 4);
}

function inferSkills(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/python/, 'Python'],
    [/scikit|sklearn/, 'scikit-learn'],
    [/tensorflow/, 'TensorFlow'],
    [/pytorch/, 'PyTorch'],
    [/openai/, 'OpenAI'],
    [/hugging\\s?face/, 'Hugging Face'],
    [/langchain/, 'LangChain'],
    [/llm|large language model/, 'LLMs'],
    [/agentic/, 'Agentic AI'],
    [/mlops/, 'MLOps'],
    [/aws|cloud/, 'AWS'],
    [/kubernetes|k8s/, 'Kubernetes'],
    [/docker|container/, 'Docker'],
  ];
  for (const [regex, skill] of checks) {
    if (regex.test(t)) out.push(skill);
  }
  return Array.from(new Set(out));
}

function fallbackExtraction(roleTitle: string, jdText: string): PositionExtraction {
  const inputText = `${roleTitle}\n${jdText}`.trim();
  const role = detectRoleFamily(inputText);
  const level = detectLevel(inputText);
  const focusAreas = inferFocusAreas(inputText);
  const tech = inferSkills(inputText);
  const mustHaves = Array.from(
    new Set([
      ...tech.slice(0, 5),
      ...(focusAreas.includes('mlops') ? ['MLOps'] : []),
      ...(focusAreas.includes('genai') ? ['LLMs', 'Agentic AI'] : []),
      ...(focusAreas.includes('leadership') ? ['Technical Leadership'] : []),
      'Problem Solving',
      'Communication',
    ]),
  ).slice(0, 8);

  const deepDiveMode: DeepDiveMode = focusAreas.includes('genai')
    ? 'domain'
    : focusAreas.includes('architecture')
      ? 'system_design'
      : 'none';
  const strictness: Strictness = level.value === 'lead' || level.value === 'principal' ? 'strict' : 'balanced';
  const evaluationPolicy: EvaluationPolicy = role.value === 'machine_learning' ? 'bar_raiser' : 'holistic';

  return {
    role_title: roleTitle || 'Software Engineer',
    role_family: role.value,
    level: level.value,
    interview_round_type: inferRoundType(inputText),
    recommended_archetype_id: role.value === 'machine_learning' ? 'ml_genai_engineering' : 'full_stack_general',
    recommended_duration_minutes: level.value === 'lead' || level.value === 'principal' ? 90 : 60,
    must_haves: mustHaves.slice(0, 8),
    nice_to_haves: tech.slice(5, 8),
    tech_stack: tech.slice(0, 15),
    focus_areas: focusAreas,
    deep_dive_mode: deepDiveMode,
    strictness,
    evaluation_policy: evaluationPolicy,
    notes_for_interviewer:
      role.value === 'machine_learning'
        ? 'Probe hands-on ML/GenAI depth, MLOps maturity, and technical leadership in production systems.'
        : 'Review role fundamentals and production readiness.',
    confidence: {
      role_family: role.confidence,
      level: level.confidence,
      must_haves: mustHaves.length >= 3 ? 0.75 : 0.55,
      tech_stack: tech.length > 0 ? 0.75 : 0.5,
      overall: Math.min(0.92, (role.confidence + level.confidence) / 2 + 0.05),
    },
    missing_fields: [],
    extraction_rationale: {
      role_family: role.rationale,
      level: level.rationale,
    },
  };
}

function buildPrompt(roleTitle: string, jdText: string): string {
  return [
    'Extract structured interview position configuration from this job description.',
    'Return STRICT JSON only, no markdown, no prose.',
    'Use concise values and limit notes_for_interviewer to <= 600 chars.',
    roleTitle ? `Optional role title provided by user: ${roleTitle}` : 'No role title provided by user.',
    'JD:',
    jdText,
  ].join('\n\n');
}

async function callOpenAIJson(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const model = process.env.OPENAI_PREFILL_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an extraction engine. Return strict JSON matching the expected schema. No markdown.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI request failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');
  return content;
}

async function fixJsonOnce(badJson: string, errors: string[]): Promise<string> {
  const prompt = [
    'Fix this JSON to satisfy schema constraints. Return JSON only.',
    `Validation errors: ${errors.join('; ')}`,
    'JSON to fix:',
    badJson,
  ].join('\n\n');

  return callOpenAIJson(prompt);
}

export async function extractAndPrefillPosition(input: {
  roleTitle?: string;
  jdText: string;
}): Promise<PrefillResult> {
  const roleTitle = String(input.roleTitle || '').trim();
  const jdText = String(input.jdText || '').trim();

  if (!jdText) {
    const fallback = fallbackExtraction(roleTitle, jdText);
    const normalized = normalizeAndMap(fallback, { jdText, roleTitleOverride: roleTitle });
    return {
      rawExtraction: fallback,
      normalizedPrefill: applyDeterministicMapping(normalized.prefill),
      extractionConfidence: normalized.confidence,
      missingFields: normalized.missingFields,
      warnings: ['JD was empty, fallback prefill used.'],
      summary: `Prepared fallback prefill for ${normalized.prefill.role_title}.`,
    };
  }

  let extractionObj: unknown;
  let rawText = '';

  try {
    rawText = await callOpenAIJson(buildPrompt(roleTitle, jdText));
    extractionObj = parseJsonWithFallback(rawText);
    let validation = validateExtractionShape(extractionObj);

    if (!validation.ok) {
      const fixed = await fixJsonOnce(rawText, validation.errors);
      extractionObj = parseJsonWithFallback(fixed);
      validation = validateExtractionShape(extractionObj);
      if (!validation.ok) {
        throw new Error(`Invalid extraction after retry: ${validation.errors.join(', ')}`);
      }
    }
  } catch (error) {
    const fallback = fallbackExtraction(roleTitle, jdText);
    const normalized = normalizeAndMap(fallback, { jdText, roleTitleOverride: roleTitle });
    return {
      rawExtraction: {
        ...fallback,
        extraction_rationale: {
          role_family: `Fallback used: ${error instanceof Error ? error.message : 'Unknown error'}`,
          level: 'Fallback path',
        },
      },
      normalizedPrefill: applyDeterministicMapping(normalized.prefill),
      extractionConfidence: normalized.confidence,
      missingFields: normalized.missingFields,
      warnings: ['LLM extraction failed. Fallback prefill used.'],
      summary: `Prepared fallback prefill for ${normalized.prefill.role_title}.`,
    };
  }

  const typed = extractionObj as PositionExtraction;
  const heuristic = fallbackExtraction(roleTitle, jdText);
  if (
    (!typed.role_family || typed.confidence?.role_family < 0.6) &&
    heuristic.confidence.role_family >= 0.6
  ) {
    typed.role_family = heuristic.role_family;
    typed.confidence.role_family = heuristic.confidence.role_family;
    typed.extraction_rationale.role_family = `${typed.extraction_rationale.role_family} | heuristic_applied`;
  }
  if ((!typed.level || typed.confidence?.level < 0.6) && heuristic.confidence.level >= 0.6) {
    typed.level = heuristic.level;
    typed.confidence.level = heuristic.confidence.level;
    typed.extraction_rationale.level = `${typed.extraction_rationale.level} | heuristic_applied`;
  }
  if (!Array.isArray(typed.must_haves) || typed.must_haves.length < 3) {
    typed.must_haves = heuristic.must_haves;
    typed.confidence.must_haves = Math.max(typed.confidence.must_haves || 0, heuristic.confidence.must_haves);
  }

  const normalized = normalizeAndMap(typed, { jdText, roleTitleOverride: roleTitle });
  const mapped = applyDeterministicMapping(normalized.prefill);

  return {
    rawExtraction: typed,
    normalizedPrefill: mapped,
    extractionConfidence: normalized.confidence,
    missingFields: normalized.missingFields,
    warnings: normalized.warnings,
    summary: `${mapped.role_title}: ${mapped.role_family} / ${mapped.level} (${mapped.duration_minutes} mins).`,
  };
}
