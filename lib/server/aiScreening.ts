type AiScreeningResult = {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  reasoning: string[];
  model: string;
};

function clampScore(input: unknown): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function toStringList(input: unknown, maxItems = 8): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildPrompt(params: { roleTitle: string; jdText: string; cvText: string }): string {
  return [
    'Score candidate fit for the role using only given JD and CV/profile context.',
    'Do not force must-have/nice-to-have structure. Use holistic judgment.',
    'Return STRICT JSON only with keys:',
    'score (0-100 integer), summary (string), strengths (string[]), gaps (string[]), reasoning (string[]).',
    'Each list item should be brief and evidence-based.',
    `Role Title: ${params.roleTitle || 'Unknown role'}`,
    'JD:',
    params.jdText,
    'CV/Profile:',
    params.cvText,
  ].join('\n\n');
}

export async function generateAiScreening(input: {
  roleTitle: string;
  jdText: string;
  cvText: string;
}): Promise<AiScreeningResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const jdText = String(input.jdText || '').trim().slice(0, 25000);
  const cvText = String(input.cvText || '').trim().slice(0, 25000);
  if (!jdText || !cvText) {
    throw new Error('JD or CV text missing for AI screening');
  }

  const model = process.env.OPENAI_SCREENING_MODEL || process.env.OPENAI_PREFILL_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a hiring evaluator. Return strict JSON only, grounded in provided JD and CV.',
        },
        {
          role: 'user',
          content: buildPrompt({
            roleTitle: String(input.roleTitle || '').trim(),
            jdText,
            cvText,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');

  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    score: clampScore(parsed.score),
    summary: String(parsed.summary || '').trim(),
    strengths: toStringList(parsed.strengths),
    gaps: toStringList(parsed.gaps),
    reasoning: toStringList(parsed.reasoning, 10),
    model,
  };
}

export type { AiScreeningResult };
