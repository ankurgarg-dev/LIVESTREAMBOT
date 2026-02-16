function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nowIso() {
  return new Date().toISOString();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildMustHaveCoverage(mustHaves) {
  const coverage = {};
  for (const item of toArray(mustHaves)) {
    const key = String(item || '').trim();
    if (!key) continue;
    coverage[key] = {
      covered: false,
      confidence: 0,
      evidence_ids: [],
      last_updated_at: nowIso(),
    };
  }
  return coverage;
}

function buildCompetencyScores(focusAreas) {
  const base = ['technical_depth', 'problem_solving', 'communication', 'system_design', 'ownership'];
  const all = Array.from(
    new Set([
      ...base,
      ...toArray(focusAreas).map((x) => String(x || '').trim()).filter(Boolean),
    ]),
  );

  const out = {};
  for (const key of all) {
    out[key] = { score: 0, confidence: 0, evidence_ids: [], observations: 0 };
  }
  return out;
}

function createInitialState({ durationMinutes = 45, mustHaves = [], focusAreas = [] } = {}) {
  const budget = Math.max(300, Number(durationMinutes || 45) * 60);
  return {
    section: 'intro',
    total_time_budget_seconds: budget,
    time_remaining: budget,
    must_have_coverage: buildMustHaveCoverage(mustHaves),
    competency_scores: buildCompetencyScores(focusAreas),
    followup_queue: [],
    defer_queue: [],
    evidence_log: [],
    contradictions: [],
    answer_quality_stats: { strong: 0, partial: 0, weak: 0, unclear: 0 },
    last_answer_summary: '',
    asked_questions: 0,
    answered_turns: 0,
    topic_probe_counts: {},
    started_at: nowIso(),
    updated_at: nowIso(),
  };
}

function computeCoverageStatus(state) {
  const entries = Object.entries(state.must_have_coverage || {});
  const covered = entries.filter(([, v]) => v?.covered).length;
  const total = entries.length;
  const pct = total === 0 ? 1 : covered / total;
  const uncovered = entries.filter(([, v]) => !v?.covered).map(([k]) => k);

  return {
    covered,
    total,
    pct,
    uncovered,
  };
}

function buildCoverageSummary(state) {
  const mustHave = Object.entries(state.must_have_coverage || {}).map(([k, v]) => ({
    must_have: k,
    covered: Boolean(v?.covered),
    confidence: clamp(Number(v?.confidence || 0), 0, 1),
  }));
  const competencies = Object.entries(state.competency_scores || {}).map(([k, v]) => ({
    competency: k,
    score: clamp(Number(v?.score || 0), 0, 5),
    confidence: clamp(Number(v?.confidence || 0), 0, 1),
  }));

  return {
    must_have: mustHave,
    competency: competencies,
    followup_queue_count: toArray(state.followup_queue).length,
    defer_queue_count: toArray(state.defer_queue).length,
  };
}

function recalcTimeRemaining(state) {
  const startedMs = Date.parse(state.started_at || nowIso());
  const elapsedSec = Number.isNaN(startedMs) ? 0 : Math.max(0, Math.round((Date.now() - startedMs) / 1000));
  const budget = Math.max(300, Number(state.total_time_budget_seconds || state.time_remaining || 300));
  state.time_remaining = clamp(budget - elapsedSec, 0, budget);
}

function mergeQueues(state, followups, queueName) {
  const existing = toArray(state[queueName]);
  const merged = [...existing];
  for (const f of toArray(followups)) {
    const skill = String(f?.skill || '').trim();
    const reason = String(f?.reason || '').trim();
    if (!skill || !reason) continue;
    merged.push({
      skill,
      reason,
      priority: clamp(Number(f?.priority || 3), 1, 5),
      created_at: nowIso(),
    });
  }
  merged.sort((a, b) => b.priority - a.priority);
  state[queueName] = merged.slice(0, queueName === 'followup_queue' ? 8 : 12);
}

function applyAnalyzerResult(state, result) {
  const timestamp = nowIso();
  const evidenceItems = toArray(result?.evidence);
  const newEvidenceIds = [];

  for (const e of evidenceItems) {
    const id = `ev_${state.evidence_log.length + 1}`;
    const item = {
      id,
      ts: timestamp,
      competency: String(e?.competency || 'technical_depth'),
      must_have: String(e?.must_have || ''),
      snippet: String(e?.snippet || '').slice(0, 320),
      assessment: String(e?.assessment || 'partial'),
    };
    state.evidence_log.push(item);
    newEvidenceIds.push(id);
  }

  const coverageUpdates = toArray(result?.must_have_updates);
  for (const update of coverageUpdates) {
    const key = String(update?.must_have || '').trim();
    if (!key || !state.must_have_coverage[key]) continue;
    const target = state.must_have_coverage[key];
    const confidence = clamp(Number(update?.confidence || 0), 0, 1);
    target.confidence = Math.max(target.confidence, confidence);
    target.covered = Boolean(update?.covered) || target.covered || target.confidence >= 0.72;
    const evidenceIds = toArray(update?.evidence_ids).map((x) => String(x || '')).filter(Boolean);
    target.evidence_ids = Array.from(new Set([...target.evidence_ids, ...evidenceIds, ...newEvidenceIds]));
    target.last_updated_at = timestamp;
  }

  const competencyUpdates = toArray(result?.competency_updates);
  for (const update of competencyUpdates) {
    const key = String(update?.competency || '').trim();
    if (!key || !state.competency_scores[key]) continue;
    const score = clamp(Number(update?.score || 0), 0, 5);
    const confidence = clamp(Number(update?.confidence || 0), 0, 1);
    const target = state.competency_scores[key];

    if (target.observations <= 0) {
      target.score = score;
    } else {
      target.score = Number(((target.score * target.observations + score) / (target.observations + 1)).toFixed(2));
    }
    target.observations += 1;
    target.confidence = Math.max(target.confidence, confidence);
    const evidenceIds = toArray(update?.evidence_ids).map((x) => String(x || '')).filter(Boolean);
    target.evidence_ids = Array.from(new Set([...target.evidence_ids, ...evidenceIds, ...newEvidenceIds]));
  }

  mergeQueues(state, result?.followup_queue, 'followup_queue');
  mergeQueues(state, result?.defer_queue, 'defer_queue');

  const contradictions = toArray(result?.contradictions).map((c) => ({
    type: String(c?.type || 'consistency'),
    description: String(c?.description || '').slice(0, 260),
    severity: String(c?.severity || 'low'),
    evidence_ids: toArray(c?.evidence_ids).map((x) => String(x || '')).filter(Boolean),
    ts: timestamp,
  }));
  state.contradictions.push(...contradictions.slice(0, 6));

  const quality = String(result?.answer_quality || 'partial');
  if (!state.answer_quality_stats[quality]) state.answer_quality_stats[quality] = 0;
  state.answer_quality_stats[quality] += 1;

  state.last_answer_summary = String(result?.answer_summary_1line || '').slice(0, 220);
  state.answered_turns += 1;
  recalcTimeRemaining(state);
  state.updated_at = timestamp;
}

function consumeFollowup(state) {
  const queue = toArray(state.followup_queue);
  if (queue.length === 0) return null;
  const next = queue.shift();
  state.followup_queue = queue;
  return next;
}

function consumeDefer(state) {
  const queue = toArray(state.defer_queue);
  if (queue.length === 0) return null;
  const next = queue.shift();
  state.defer_queue = queue;
  return next;
}

function incrementTopicProbeCount(state, topic) {
  const key = String(topic || '').trim().toLowerCase();
  if (!key) return;
  const current = Number(state.topic_probe_counts?.[key] || 0);
  state.topic_probe_counts[key] = current + 1;
}

function getTopicProbeCount(state, topic) {
  const key = String(topic || '').trim().toLowerCase();
  if (!key) return 0;
  return Number(state.topic_probe_counts?.[key] || 0);
}

function applyDeterministicGates(state) {
  recalcTimeRemaining(state);
  const coverage = computeCoverageStatus(state);
  const budget = Math.max(300, Number(state.total_time_budget_seconds || 300));
  const elapsedRatio = 1 - state.time_remaining / budget;

  if (state.time_remaining <= 240) {
    state.section = 'wrap_up';
  } else if (state.section === 'intro' && state.asked_questions >= 1) {
    state.section = 'core';
  } else if (state.section === 'core' && elapsedRatio >= 0.8 && coverage.pct < 1) {
    state.section = 'core';
  } else if (state.section === 'core' && (coverage.pct >= 0.85 || state.asked_questions >= 7)) {
    state.section = 'deep_dive';
  } else if (state.section === 'deep_dive' && (state.time_remaining <= 420 || state.asked_questions >= 11)) {
    state.section = 'wrap_up';
  }

  if (state.section === 'wrap_up' && state.asked_questions >= 13) {
    state.section = 'completed';
  }
}

module.exports = {
  createInitialState,
  computeCoverageStatus,
  buildCoverageSummary,
  applyAnalyzerResult,
  consumeFollowup,
  consumeDefer,
  incrementTopicProbeCount,
  getTopicProbeCount,
  applyDeterministicGates,
};
