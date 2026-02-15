import {
  applyDeterministicMapping,
  normalizeAndMap,
  parseJsonWithFallback,
  validateExtractionShape,
} from '@/lib/position/logic';
import type { PositionExtraction, PrefillResult } from '@/lib/position/types';

function fallbackExtraction(roleTitle: string, jdText: string): PositionExtraction {
  return {
    role_title: roleTitle || 'Software Engineer',
    role_family: 'full_stack',
    level: 'mid',
    interview_round_type: 'standard',
    recommended_archetype_id: 'full_stack_general',
    recommended_duration_minutes: 60,
    must_haves: ['Problem Solving', 'Coding Fundamentals', 'Communication'],
    nice_to_haves: [],
    tech_stack: [],
    focus_areas: ['coding', 'problem_solving'],
    deep_dive_mode: 'none',
    strictness: 'balanced',
    evaluation_policy: 'holistic',
    notes_for_interviewer: 'Review core problem solving and fundamentals.',
    confidence: {
      role_family: 0.55,
      level: 0.55,
      must_haves: 0.6,
      tech_stack: 0.4,
      overall: 0.5,
    },
    missing_fields: ['role_family', 'level'],
    extraction_rationale: {
      role_family: 'Fallback prefill used due to low confidence or unavailable LLM.',
      level: 'Fallback prefill used due to low confidence or unavailable LLM.',
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
