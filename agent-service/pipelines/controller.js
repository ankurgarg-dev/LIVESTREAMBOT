const { buildFallbackQuestion } = require('../fallbackBank');

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeIntent(v, fallback = 'technical_validation') {
  const allowed = ['behavioral_star_l', 'technical_validation', 'deep_dive', 'clarification', 'wrapup', 'candidate_questions'];
  return allowed.includes(v) ? v : fallback;
}

function normalizeFormat(v, fallback = 'steps+tradeoffs') {
  const allowed = ['STAR-L', 'steps+tradeoffs', 'short_fact', 'walkthrough'];
  return allowed.includes(v) ? v : fallback;
}

function sanitizeControllerOutput(raw, fallback) {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  return {
    section: String(raw.section || fallback.section),
    question: String(raw.question || '').trim() || fallback.question,
    rationale: String(raw.rationale || '').trim() || fallback.rationale,
    end_interview: Boolean(raw.end_interview),
    question_intent: normalizeIntent(String(raw.question_intent || ''), fallback.question_intent),
    expected_answer_format: normalizeFormat(String(raw.expected_answer_format || ''), fallback.expected_answer_format),
    probes: toArray(raw.probes).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4),
    must_haves_targeted: toArray(raw.must_haves_targeted).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3),
    timebox_seconds: clamp(Number(raw.timebox_seconds || fallback.timebox_seconds), 30, 240),
  };
}

async function runController({
  llmService,
  contextPack,
  state,
  transcriptTail,
  evidenceTail,
  coverageSummary,
  openFollowups,
  followupHint,
}) {
  const fallback = {
    section: state.section,
    ...buildFallbackQuestion({
      roleFamily: contextPack?.role_family,
      section: state.section,
      askedQuestions: state.asked_questions,
      uncoveredMustHaves: toArray(coverageSummary?.must_have).filter((x) => !x.covered).map((x) => x.must_have),
    }),
  };

  const prompt = [
    'You are the Interview Controller for a professional technical interview.',
    'Return JSON only.',
    'Rules:',
    '1) Ask exactly one question in this turn.',
    '2) Respect section and timebox.',
    '3) Enforce STAR-L for behavioral evidence.',
    '4) Prioritize uncovered must-haves and blocking follow-ups.',
    '5) Keep wording concise for spoken conversation.',
    '',
    `Context pack: ${JSON.stringify(contextPack)}`,
    `State: ${JSON.stringify({ section: state.section, time_remaining: state.time_remaining, asked_questions: state.asked_questions })}`,
    `Coverage summary: ${JSON.stringify(coverageSummary)}`,
    `Open followups: ${JSON.stringify(openFollowups || [])}`,
    `Followup hint: ${followupHint || 'none'}`,
    `Evidence tail: ${JSON.stringify(evidenceTail || [])}`,
    `Transcript tail: ${JSON.stringify(transcriptTail || [])}`,
    '',
    'Output schema:',
    '{',
    '  "section": "intro|core|deep_dive|wrap_up|completed",',
    '  "question": "string",',
    '  "question_intent": "behavioral_star_l|technical_validation|deep_dive|clarification|wrapup|candidate_questions",',
    '  "expected_answer_format": "STAR-L|steps+tradeoffs|short_fact|walkthrough",',
    '  "probes": ["string"],',
    '  "must_haves_targeted": ["string"],',
    '  "timebox_seconds": number,',
    '  "rationale": "string",',
    '  "end_interview": boolean',
    '}',
  ].join('\n');

  try {
    const raw = await llmService.callJson(prompt, {
      model: process.env.OPENAI_CONTROLLER_MODEL || llmService.model,
      temperature: 0.15,
    });
    return sanitizeControllerOutput(raw, fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  runController,
};
