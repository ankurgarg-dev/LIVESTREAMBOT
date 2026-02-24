import {
  applyDeterministicMapping,
  normalizeAndMap,
  parseJsonWithFallback,
  validateExtractionShape,
} from '@/lib/position/logic';
import { buildSkillTypeByName } from '@/lib/server/skillTypeMap';
import type {
  DeepDiveMode,
  EvaluationPolicy,
  FocusArea,
  Level,
  PositionExtraction,
  PrefillResult,
  Strictness,
} from '@/lib/position/types';

function inferRoleTitleFromJd(jdText: string): string {
  const text = String(jdText || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 20)) {
    const m = line.match(/^\s*(title|job title|position)\s*:\s*(.+)$/i);
    if (m?.[2]) return m[2].trim().slice(0, 120);
  }
  for (const line of lines.slice(0, 30)) {
    if (/^(about|responsibilities|requirements|what you'll need|must have|nice to have)\b/i.test(line)) continue;
    if (line.length < 6 || line.length > 90) continue;
    if (!/(engineer|developer|architect|scientist|manager|lead|specialist|analyst|qa|sre|devops|consultant)/i.test(line)) continue;
    return line.replace(/^[\-*•\d.)\s]+/, '').trim().slice(0, 120);
  }
  return 'Software Engineer';
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
  const inferredRoleTitle = roleTitle || inferRoleTitleFromJd(jdText);
  const level = detectLevel(inputText);
  const focusAreas = inferFocusAreas(inputText);
  const tech = inferSkills(inputText);
  const mustHaves = Array.from(
    new Set([
      ...tech.slice(0, 5),
      ...(focusAreas.includes('mlops') ? ['MLOps'] : []),
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
  const evaluationPolicy: EvaluationPolicy = focusAreas.includes('genai') ? 'bar_raiser' : 'holistic';

  return {
    role_title: inferredRoleTitle,
    level: level.value,
    recommended_duration_minutes: level.value === 'lead' || level.value === 'principal' ? 90 : 60,
    must_haves: mustHaves.slice(0, 8),
    nice_to_haves: Array.from(
      new Set([
        ...tech.slice(5, 8),
        ...(focusAreas.includes('genai') ? ['LLMs', 'Agentic AI'] : []),
      ]),
    ).slice(0, 8),
    tech_stack: tech.slice(0, 15),
    focus_areas: focusAreas,
    deep_dive_mode: deepDiveMode,
    strictness,
    evaluation_policy: evaluationPolicy,
    notes_for_interviewer:
      focusAreas.includes('genai')
        ? 'Probe hands-on ML/GenAI depth, MLOps maturity, and technical leadership in production systems.'
        : 'Review role fundamentals and production readiness.',
    confidence: {
      level: level.confidence,
      must_haves: mustHaves.length >= 3 ? 0.75 : 0.55,
      tech_stack: tech.length > 0 ? 0.75 : 0.5,
      overall: Math.min(0.92, level.confidence + 0.05),
    },
    missing_fields: [],
    extraction_rationale: {
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

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean);
}

function toNumber01(input: unknown, fallback = 0): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (Number.isNaN(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function coerceExtractionCandidate(input: unknown): PositionExtraction {
  const p = (input || {}) as Record<string, unknown>;
  const conf = (p.confidence || {}) as Record<string, unknown>;
  const rationale = (p.extraction_rationale || {}) as Record<string, unknown>;

  return {
    role_title: String(p.role_title || '').trim(),
    level: String(p.level || '').trim(),
    recommended_duration_minutes: Number(p.recommended_duration_minutes || 0),
    must_haves: toStringArray(p.must_haves),
    nice_to_haves: toStringArray(p.nice_to_haves),
    tech_stack: toStringArray(p.tech_stack),
    focus_areas: toStringArray(p.focus_areas),
    deep_dive_mode: String(p.deep_dive_mode || '').trim(),
    strictness: String(p.strictness || '').trim(),
    evaluation_policy: String(p.evaluation_policy || '').trim(),
    notes_for_interviewer: String(p.notes_for_interviewer || '').slice(0, 600),
    confidence: {
      level: toNumber01(conf.level),
      must_haves: toNumber01(conf.must_haves),
      tech_stack: toNumber01(conf.tech_stack),
      overall: toNumber01(conf.overall),
    },
    missing_fields: toStringArray(p.missing_fields),
    extraction_rationale: {
      level: typeof rationale.level === 'string' ? rationale.level : JSON.stringify(rationale.level ?? ''),
    },
  };
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
  const inferredRoleTitle = roleTitle || inferRoleTitleFromJd(jdText);
  const skillTypeByName = await buildSkillTypeByName();

  if (!jdText) {
    const fallback = fallbackExtraction(inferredRoleTitle, jdText);
    const normalized = normalizeAndMap(fallback, {
      jdText,
      roleTitleOverride: roleTitle || inferredRoleTitle,
      skillTypeByName,
    });
    return {
      rawExtraction: fallback,
      normalizedPrefill: applyDeterministicMapping(normalized.prefill, { skillTypeByName }),
      extractionConfidence: normalized.confidence,
      missingFields: normalized.missingFields,
      warnings: ['JD was empty, fallback prefill used.'],
      summary: `Prepared fallback prefill for ${normalized.prefill.role_title}.`,
    };
  }

  let extractionObj: unknown;
  let rawText = '';

  try {
    rawText = await callOpenAIJson(buildPrompt(roleTitle || inferredRoleTitle, jdText));
    extractionObj = coerceExtractionCandidate(parseJsonWithFallback(rawText));
    let validation = validateExtractionShape(extractionObj);

    if (!validation.ok) {
      const fixed = await fixJsonOnce(rawText, validation.errors);
      extractionObj = coerceExtractionCandidate(parseJsonWithFallback(fixed));
      validation = validateExtractionShape(extractionObj);
      if (!validation.ok) {
        throw new Error(`Invalid extraction after retry: ${validation.errors.join(', ')}`);
      }
    }
  } catch (error) {
    const fallback = fallbackExtraction(inferredRoleTitle, jdText);
    const normalized = normalizeAndMap(fallback, {
      jdText,
      roleTitleOverride: roleTitle || inferredRoleTitle,
      skillTypeByName,
    });
    return {
      rawExtraction: {
        ...fallback,
        extraction_rationale: {
          level: 'Fallback path',
        },
      },
      normalizedPrefill: applyDeterministicMapping(normalized.prefill, { skillTypeByName }),
      extractionConfidence: normalized.confidence,
      missingFields: normalized.missingFields,
      warnings: ['LLM extraction failed. Fallback prefill used.'],
      summary: `Prepared fallback prefill for ${normalized.prefill.role_title}.`,
    };
  }

  const typed = extractionObj as PositionExtraction;
  const heuristic = fallbackExtraction(inferredRoleTitle, jdText);
  if (!typed.role_title || typed.role_title.length < 4) {
    typed.role_title = inferredRoleTitle;
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
  if (!Array.isArray(typed.tech_stack) || typed.tech_stack.length < 2) {
    typed.tech_stack = heuristic.tech_stack;
    typed.confidence.tech_stack = Math.max(typed.confidence.tech_stack || 0, heuristic.confidence.tech_stack);
  }
  if (!typed.recommended_duration_minutes || !Number.isFinite(typed.recommended_duration_minutes)) {
    typed.recommended_duration_minutes = heuristic.recommended_duration_minutes;
  }
  if (!typed.confidence || typeof typed.confidence !== 'object') {
    typed.confidence = heuristic.confidence;
  } else {
    const parts = [
      Number(typed.confidence.level || 0),
      Number(typed.confidence.must_haves || 0),
      Number(typed.confidence.tech_stack || 0),
    ].filter((n) => n > 0);
    if (!typed.confidence.overall || typed.confidence.overall <= 0) {
      const avg = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : heuristic.confidence.overall;
      typed.confidence.overall = Math.min(0.95, Math.max(0.45, avg));
    }
  }

  const normalized = normalizeAndMap(typed, {
    jdText,
    roleTitleOverride: roleTitle || inferredRoleTitle,
    skillTypeByName,
  });
  const mapped = applyDeterministicMapping(normalized.prefill, { skillTypeByName });

  return {
    rawExtraction: typed,
    normalizedPrefill: mapped,
    extractionConfidence: normalized.confidence,
    missingFields: normalized.missingFields,
    warnings: normalized.warnings,
    summary: `${mapped.role_title}: ${mapped.level} (${mapped.duration_minutes} mins).`,
  };
}
