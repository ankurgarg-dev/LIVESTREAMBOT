function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function fallbackFinal({ finalState, positionConfig, candidateName }) {
  const comps = finalState.competency_scores || {};
  const competencyScores = Object.entries(comps).map(([name, v]) => ({
    competency: name,
    score: clamp(Number(v?.score || 0), 0, 5),
    confidence: clamp(Number(v?.confidence || 0), 0, 1),
  }));

  const avg = competencyScores.length
    ? competencyScores.reduce((sum, s) => sum + s.score, 0) / competencyScores.length
    : 0;

  const overallWeighted = Number(avg.toFixed(2));
  const confidence = Number(
    (competencyScores.reduce((sum, s) => sum + s.confidence, 0) / Math.max(1, competencyScores.length)).toFixed(2),
  );

  const mustHaveCoverage = Object.entries(finalState.must_have_coverage || {}).map(([skill, v]) => ({
    must_have: skill,
    covered: Boolean(v?.covered),
    confidence: clamp(Number(v?.confidence || 0), 0, 1),
  }));

  let recommendation = 'hold';
  if (overallWeighted >= 3.6 && confidence >= 0.6) recommendation = 'strong_hire';
  else if (overallWeighted >= 3.0) recommendation = 'hire';
  else if (overallWeighted < 2.2) recommendation = 'no_hire';

  return {
    overall_weighted_score: overallWeighted,
    confidence,
    competency_scores: competencyScores,
    must_have_coverage: mustHaveCoverage,
    strengths: ['Showed baseline technical communication and problem-solving intent.'],
    risks: mustHaveCoverage.filter((m) => !m.covered).map((m) => `Uncovered must-have: ${m.must_have}`),
    recommendation,
    summary: `Final evaluation generated for ${candidateName || 'candidate'} against ${positionConfig?.role_title || 'role'}.`,
  };
}

function sanitizeFinal(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    overall_weighted_score: clamp(Number(raw.overall_weighted_score || fallback.overall_weighted_score), 0, 4),
    confidence: clamp(Number(raw.confidence || fallback.confidence), 0, 1),
    competency_scores: toArray(raw.competency_scores),
    must_have_coverage: toArray(raw.must_have_coverage),
    strengths: toArray(raw.strengths).map((x) => String(x)),
    risks: toArray(raw.risks).map((x) => String(x)),
    recommendation: String(raw.recommendation || fallback.recommendation),
    summary: String(raw.summary || fallback.summary),
  };
}

async function runFinalEvaluator({
  llmService,
  positionConfig,
  finalState,
  evidenceLog,
  mustHaveCoverage,
  competencyCoverage,
  contradictions,
  answerQualityStats,
  transcriptSummary,
  candidateName,
}) {
  const fallback = fallbackFinal({ finalState, positionConfig, candidateName });

  const prompt = [
    'You are the Final Evaluator for a structured technical interview.',
    'Return JSON only.',
    'Inputs are already structured; prioritize consistency and evidence defensibility.',
    `Position config: ${JSON.stringify(positionConfig || {})}`,
    `Candidate: ${candidateName || 'Candidate'}`,
    `Final state summary: ${JSON.stringify({ section: finalState.section, time_remaining: finalState.time_remaining })}`,
    `Must-have coverage: ${JSON.stringify(mustHaveCoverage || [])}`,
    `Competency coverage: ${JSON.stringify(competencyCoverage || [])}`,
    `Contradictions: ${JSON.stringify(contradictions || [])}`,
    `Answer quality stats: ${JSON.stringify(answerQualityStats || {})}`,
    `Evidence log: ${JSON.stringify(evidenceLog || [])}`,
    `Transcript summary: ${JSON.stringify(transcriptSummary || [])}`,
    '',
    'Output schema:',
    '{',
    '  "overall_weighted_score": 0..4,',
    '  "confidence": 0..1,',
    '  "competency_scores": [{"competency":"string","score":0..4,"confidence":0..1}],',
    '  "must_have_coverage": [{"must_have":"string","covered":boolean,"confidence":0..1}],',
    '  "strengths": string[],',
    '  "risks": string[],',
    '  "recommendation": "strong_hire|hire|hold|no_hire",',
    '  "summary": "string"',
    '}',
  ].join('\n');

  try {
    const raw = await llmService.callJson(prompt, {
      model: process.env.OPENAI_FINAL_EVAL_MODEL || llmService.model,
      temperature: 0.05,
    });
    return sanitizeFinal(raw, fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  runFinalEvaluator,
};
