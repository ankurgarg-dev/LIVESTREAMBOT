function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasWord(text, token) {
  const t = String(text || '').toLowerCase();
  return t.includes(String(token || '').toLowerCase());
}

function fallbackAnalyzer({ mustHaves = [], answer, questionIntent = 'technical_validation' }) {
  const normalized = String(answer || '').toLowerCase();
  const words = normalized.split(/\s+/g).filter(Boolean);

  const updates = toArray(mustHaves).slice(0, 8).map((skill) => {
    const covered = hasWord(normalized, skill);
    return {
      must_have: String(skill),
      covered,
      confidence: covered ? 0.72 : 0.24,
      evidence_ids: [],
    };
  });

  const star = {
    S: /(situation|context|scenario)/i.test(answer),
    T: /(task|goal|objective|problem)/i.test(answer),
    A: /(i did|implemented|built|designed|decided|approach)/i.test(answer),
    R: /(result|impact|improved|reduced|increased|latency|cost|accuracy)/i.test(answer),
    L: /(learn|lesson|next time|would change|retrospective)/i.test(answer),
  };

  const quality = words.length > 120 ? 'strong' : words.length > 50 ? 'partial' : 'weak';

  const followupQueue = [];
  if (questionIntent === 'behavioral_star_l') {
    if (!star.R) followupQueue.push({ skill: 'results', reason: 'Missing measurable result', priority: 5 });
    if (!star.L) followupQueue.push({ skill: 'learning', reason: 'Missing explicit learning', priority: 4 });
  }

  if (words.length < 24) {
    followupQueue.push({ skill: 'depth', reason: 'Answer too brief; request deeper technical detail.', priority: 4 });
  }

  return {
    must_have_updates: updates,
    competency_updates: [
      {
        competency: 'technical_depth',
        score: clamp(Math.round(words.length / 25), 1, 5),
        confidence: 0.52,
        evidence_ids: [],
      },
      {
        competency: 'communication',
        score: quality === 'strong' ? 4 : quality === 'partial' ? 3 : 2,
        confidence: 0.5,
        evidence_ids: [],
      },
    ],
    evidence: [
      {
        competency: 'technical_depth',
        must_have: '',
        snippet: String(answer || '').slice(0, 240),
        assessment: quality === 'strong' ? 'strong' : quality,
      },
    ],
    followup_queue: followupQueue.slice(0, 3),
    defer_queue: [],
    contradictions: [],
    vagueness_flags: words.length < 24 ? [{ reason: 'very_short_answer', evidence_ids: [] }] : [],
    star_l_completeness: star,
    answer_summary_1line: String(answer || '').slice(0, 140),
    answer_quality: quality,
  };
}

function sanitizeAnalyzer(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    must_have_updates: toArray(raw.must_have_updates),
    competency_updates: toArray(raw.competency_updates),
    evidence: toArray(raw.evidence),
    followup_queue: toArray(raw.followup_queue),
    defer_queue: toArray(raw.defer_queue),
    contradictions: toArray(raw.contradictions),
    vagueness_flags: toArray(raw.vagueness_flags),
    star_l_completeness: raw.star_l_completeness && typeof raw.star_l_completeness === 'object'
      ? raw.star_l_completeness
      : fallback.star_l_completeness,
    answer_summary_1line: String(raw.answer_summary_1line || fallback.answer_summary_1line || '').slice(0, 220),
    answer_quality: String(raw.answer_quality || fallback.answer_quality || 'partial'),
  };
}

async function runAnalyzer({
  llmService,
  contextPack,
  state,
  question,
  answer,
  questionMeta,
}) {
  const mustHaves = toArray(contextPack?.must_haves);
  const fallback = fallbackAnalyzer({
    mustHaves,
    answer,
    questionIntent: questionMeta?.question_intent,
  });

  const prompt = [
    'You are the Answer Analyzer.',
    'Return JSON only.',
    'Responsibilities:',
    '1) Extract structured signals from the answer.',
    '2) Update must-have coverage.',
    '3) Emit evidence entries.',
    '4) Emit follow-up/defer queues.',
    '5) Evaluate STAR-L completeness for applicable intents.',
    '6) Flag contradictions and vagueness.',
    '',
    `Context pack: ${JSON.stringify(contextPack)}`,
    `Section: ${state.section}`,
    `Question meta: ${JSON.stringify(questionMeta || {})}`,
    `Question: ${question}`,
    `Answer: ${answer}`,
    '',
    'Output schema:',
    '{',
    '  "must_have_updates": [{"must_have":"string","covered":boolean,"confidence":0..1,"evidence_ids":string[]}],',
    '  "competency_updates": [{"competency":"string","score":0..5,"confidence":0..1,"evidence_ids":string[]}],',
    '  "evidence": [{"competency":"string","must_have":"string","snippet":"string","assessment":"strong|partial|weak|unclear"}],',
    '  "followup_queue": [{"skill":"string","reason":"string","priority":1..5}],',
    '  "defer_queue": [{"skill":"string","reason":"string","priority":1..5}],',
    '  "star_l_completeness": {"S":boolean,"T":boolean,"A":boolean,"R":boolean,"L":boolean},',
    '  "contradictions": [{"type":"string","description":"string","severity":"low|medium|high","evidence_ids":string[]}],',
    '  "vagueness_flags": [{"reason":"string","evidence_ids":string[]}],',
    '  "answer_summary_1line": "string",',
    '  "answer_quality": "strong|partial|weak|unclear"',
    '}',
  ].join('\n');

  try {
    const raw = await llmService.callJson(prompt, {
      model: process.env.OPENAI_ANALYZER_MODEL || llmService.model,
      temperature: 0.1,
    });
    return sanitizeAnalyzer(raw, fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  runAnalyzer,
};
