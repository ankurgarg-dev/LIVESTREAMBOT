const { getInterviewByRoomName, patchInterviewByRoomName } = require('./interviewStoreClient');
const { buildContextPack } = require('./contextPack');
const {
  createInitialState,
  computeCoverageStatus,
  buildCoverageSummary,
  applyAnalyzerResult,
  consumeFollowup,
  consumeDefer,
  incrementTopicProbeCount,
  getTopicProbeCount,
  applyDeterministicGates,
} = require('./interviewStateMachine');
const { runController } = require('./pipelines/controller');
const { runAnalyzer } = require('./pipelines/analyzer');
const { runFinalEvaluator } = require('./pipelines/finalEvaluator');
const { buildFallbackQuestion } = require('./fallbackBank');

const WRAPUP_BUFFER_SECONDS = Math.max(180, Number(process.env.WRAPUP_BUFFER_SECONDS || 240));
const MUST_HAVE_SWEEP_RATIO = clampNumber(Number(process.env.MUST_HAVE_SWEEP_RATIO || 0.8), 0.5, 0.95);
const MAX_PROBES_PER_TOPIC = Math.max(1, Number(process.env.MAX_PROBES_PER_TOPIC || 2));

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRecommendation(value) {
  const allowed = ['strong_hire', 'hire', 'hold', 'no_hire'];
  return allowed.includes(value) ? value : 'hold';
}

function firstSentence(text) {
  const str = String(text || '').trim();
  if (!str) return '';
  const m = str.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : str;
}

function sanitizeQuestionText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  // Hard deterministic guard: one question max
  const first = raw.split('?')[0];
  const out = `${first.trim()}?`;
  return out.length > 420 ? `${out.slice(0, 417)}...` : out;
}

function topOpenFollowups(state, limit = 3) {
  return toArray(state.followup_queue).slice(0, limit);
}

function getEvidenceTail(state, limit = 8) {
  return toArray(state.evidence_log).slice(-limit);
}

class InterviewEngine {
  constructor({ roomName, botName = 'Bristlecone AI Agent', llmService }) {
    this.roomName = roomName;
    this.botName = botName;
    this.llmService = llmService;
    this.interview = null;
    this.contextPack = null;
    this.state = null;
    this.transcript = [];
    this.lastControllerMeta = null;
    this.lastQuestion = '';
    this.finalized = false;
    this.awaitingIntroConsent = true;
  }

  async init() {
    this.interview = await getInterviewByRoomName(this.roomName);
    const position = this.interview?.positionSnapshot || {};
    const duration = Number(position.duration_minutes || this.interview?.durationMinutes || 45);

    this.contextPack = buildContextPack(this.interview || {});
    this.state = createInitialState({
      durationMinutes: duration,
      mustHaves: this.contextPack.must_haves,
      focusAreas: this.contextPack.focus_areas,
    });

    await this.persist({
      meetingActualStart: this.interview?.meetingActualStart || nowIso(),
      engineState: this.state,
      enginePlan: {
        role_title: this.contextPack.role_title,
        must_haves: this.contextPack.must_haves,
        focus_areas: this.contextPack.focus_areas,
        responsibilities: this.contextPack.responsibilities,
      },
      status: 'scheduled',
    });
  }

  getControllerSystemPrompt() {
    return [
      'You are a structured technical interview controller.',
      'You ask one question at a time, concise spoken phrasing, no markdown.',
      'You enforce STAR-L, must-have coverage, and interview pacing.',
      `Role=${this.contextPack?.role_title || 'Software Engineer'}`,
      `Level=${this.contextPack?.level || 'mid'}`,
    ].join(' ');
  }

  buildIntroConsentPrompt() {
    const durationMinutes = Number(this.state?.total_time_budget_seconds || 2700) / 60;
    const roundedDuration = Math.max(15, Math.round(durationMinutes));
    const candidateName = String(this.contextPack?.candidate_name || 'there').trim();
    return [
      `Hi ${candidateName}, welcome and thanks for joining today.`,
      `Quick overview before we start: this interview is about ${roundedDuration} minutes.`,
      'I will ask one question at a time and we will focus on concrete examples, tradeoffs, and measurable outcomes.',
      'A STAR-L style answer works best: situation, task, actions, results, and what you learned.',
      'If anything is unclear, you can ask me to repeat or clarify at any point.',
      'Does this plan sound good, and may we begin?',
    ].join(' ');
  }

  isConsentAffirmed(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return false;
    if (/\b(no|not now|don\'t|do not|stop|pause|later)\b/.test(t)) return false;
    return /\b(yes|yeah|yep|sure|ok|okay|sounds good|let\'s start|lets start|go ahead|proceed|ready)\b/.test(t);
  }

  registerParticipant(identity) {
    const joined = String(this.interview?.participantsJoined || '').trim();
    const set = new Set(
      joined
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );
    if (identity) set.add(identity);
    this.persist({ participantsJoined: Array.from(set).join(', ') }).catch(() => undefined);
  }

  async getKickoffQuestion() {
    const question = this.buildIntroConsentPrompt();
    const controller = {
      section: 'intro',
      question,
      question_intent: 'wrapup',
      expected_answer_format: 'short_fact',
      probes: [],
      must_haves_targeted: [],
      timebox_seconds: 45,
      rationale: 'deterministic_intro_consent',
      end_interview: false,
    };
    this.lastControllerMeta = controller;
    this.lastQuestion = question;

    this.transcript.push({
      role: 'assistant',
      by: this.botName,
      text: question,
      ts: nowIso(),
      section: this.state.section,
      stage: 'controller',
      meta: controller,
    });

    await this.persistProgress();
    return question;
  }

  needsMustHaveSweep() {
    const coverage = computeCoverageStatus(this.state);
    const budget = Math.max(300, Number(this.state.total_time_budget_seconds || 300));
    const elapsedRatio = 1 - this.state.time_remaining / budget;
    return elapsedRatio >= MUST_HAVE_SWEEP_RATIO && coverage.pct < 1;
  }

  buildMustHaveSweepQuestion() {
    const coverage = computeCoverageStatus(this.state);
    const target = coverage.uncovered.slice(0, 2);
    if (target.length === 0) return '';
    return sanitizeQuestionText(
      `Before we move on, please give a STAR-L example demonstrating ${target.join(' and ')} in a production context with measurable outcome`,
    );
  }

  buildDeterministicFollowupFromAnalyzer(analyzerResult) {
    const vagueness = toArray(analyzerResult?.vagueness_flags);
    const contradictions = toArray(analyzerResult?.contradictions);
    const star = analyzerResult?.star_l_completeness || {};

    if (vagueness.length > 0) {
      return 'Could you add more concrete technical detail, including architecture choices, tradeoffs, and measurable impact?';
    }
    if (contradictions.length > 0) {
      return 'I heard two conflicting points. Can you reconcile them with a concrete sequence of what actually happened?';
    }
    if (this.lastControllerMeta?.expected_answer_format === 'STAR-L') {
      const missing = ['S', 'T', 'A', 'R', 'L'].filter((k) => !star[k]);
      if (missing.length > 0) {
        return `Please fill the missing STAR-L parts: ${missing.join(', ')}.`;
      }
    }
    return '';
  }

  async runControllerWithGuards(followupHint = '') {
    applyDeterministicGates(this.state);

    if (this.state.time_remaining <= WRAPUP_BUFFER_SECONDS) {
      this.state.section = 'wrap_up';
    }

    const blockingFollowup = consumeFollowup(this.state);
    const deferred = !blockingFollowup ? consumeDefer(this.state) : null;
    const selectedFollowup = blockingFollowup || deferred;

    const coverageSummary = buildCoverageSummary(this.state);
    const evidenceTail = getEvidenceTail(this.state);
    const transcriptTail = this.transcript.slice(-10);

    let controller = null;
    if (selectedFollowup && getTopicProbeCount(this.state, selectedFollowup.skill) >= MAX_PROBES_PER_TOPIC) {
      controller = {
        section: this.state.section,
        ...buildFallbackQuestion({
          roleFamily: this.contextPack?.role_family,
          section: this.state.section,
          askedQuestions: this.state.asked_questions,
          uncoveredMustHaves: computeCoverageStatus(this.state).uncovered,
        }),
      };
    } else {
      controller = await runController({
        llmService: this.llmService,
        contextPack: this.contextPack,
        state: this.state,
        transcriptTail,
        evidenceTail,
        coverageSummary,
        openFollowups: topOpenFollowups(this.state, 3),
        followupHint: selectedFollowup ? `${selectedFollowup.skill}: ${selectedFollowup.reason}` : followupHint,
      });
    }

    if (selectedFollowup?.skill) {
      incrementTopicProbeCount(this.state, selectedFollowup.skill);
    }

    if (this.needsMustHaveSweep() && this.state.section !== 'wrap_up') {
      const sweepQuestion = this.buildMustHaveSweepQuestion();
      if (sweepQuestion) {
        controller.question = sweepQuestion;
        controller.question_intent = 'technical_validation';
        controller.expected_answer_format = 'STAR-L';
        controller.must_haves_targeted = computeCoverageStatus(this.state).uncovered.slice(0, 2);
        controller.probes = ['What was the measurable impact?', 'What tradeoff did you choose and why?'];
        controller.timebox_seconds = 120;
        controller.rationale = `${controller.rationale || 'controller'} | forced_must_have_sweep`;
      }
    }

    if (this.state.section === 'wrap_up') {
      controller.question_intent = 'wrapup';
      controller.expected_answer_format = 'short_fact';
      controller.timebox_seconds = Math.min(75, Number(controller.timebox_seconds || 60));
    }

    return controller;
  }

  async handleCandidateTurn(text, sourceIdentity = 'participant') {
    const answer = String(text || '').trim();
    if (!answer) return '';

    if (this.awaitingIntroConsent && this.state.section === 'intro') {
      this.transcript.push({
        role: 'candidate',
        by: sourceIdentity,
        text: answer,
        ts: nowIso(),
        section: this.state.section,
        stage: 'intro_consent',
        answer_to: this.lastQuestion,
      });

      if (!this.isConsentAffirmed(answer)) {
        const followup =
          'No problem. Before we continue, please confirm when you are comfortable to start, and I can also re-explain the format briefly.';
        this.lastQuestion = followup;
        this.lastControllerMeta = {
          section: 'intro',
          question: followup,
          question_intent: 'clarification',
          expected_answer_format: 'short_fact',
          probes: [],
          must_haves_targeted: [],
          timebox_seconds: 30,
          rationale: 'intro_consent_reconfirm',
          end_interview: false,
        };
        this.transcript.push({
          role: 'assistant',
          by: this.botName,
          text: followup,
          ts: nowIso(),
          section: this.state.section,
          stage: 'controller',
          meta: this.lastControllerMeta,
        });
        await this.persistProgress();
        return followup;
      }

      this.awaitingIntroConsent = false;
      applyDeterministicGates(this.state);
      let controller = await this.runControllerWithGuards(
        'Kickoff question after consent. Start with a warm, low-pressure opener before deep technical probing.',
      );
      let question = sanitizeQuestionText(controller.question);
      if (!question) {
        const fallback = buildFallbackQuestion({
          roleFamily: this.contextPack?.role_family,
          section: this.state.section,
          askedQuestions: this.state.asked_questions,
          uncoveredMustHaves: computeCoverageStatus(this.state).uncovered,
        });
        question = sanitizeQuestionText(fallback.question);
        controller = {
          section: this.state.section,
          ...fallback,
        };
      }

      this.lastControllerMeta = controller;
      this.lastQuestion = question;
      this.state.asked_questions += 1;
      applyDeterministicGates(this.state);

      this.transcript.push({
        role: 'assistant',
        by: this.botName,
        text: question,
        ts: nowIso(),
        section: this.state.section,
        stage: 'controller',
        meta: controller,
      });
      await this.persistProgress();
      return question;
    }

    this.transcript.push({
      role: 'candidate',
      by: sourceIdentity,
      text: answer,
      ts: nowIso(),
      section: this.state.section,
      stage: 'answer',
      answer_to: this.lastQuestion,
    });

    const analyzer = await runAnalyzer({
      llmService: this.llmService,
      contextPack: this.contextPack,
      state: this.state,
      question: this.lastQuestion,
      answer,
      questionMeta: this.lastControllerMeta,
    });

    applyAnalyzerResult(this.state, analyzer);

    const forcedFollowup = this.buildDeterministicFollowupFromAnalyzer(analyzer);
    let controller = await this.runControllerWithGuards(forcedFollowup || '');

    if (forcedFollowup) {
      controller.question = forcedFollowup;
      controller.question_intent = 'clarification';
      controller.expected_answer_format = 'steps+tradeoffs';
      controller.probes = ['Please include concrete result.', 'What did you learn and change after this?'];
      controller.timebox_seconds = 90;
      controller.rationale = `${controller.rationale || 'controller'} | deterministic_followup`;
      controller.end_interview = false;
    }

    let question = sanitizeQuestionText(controller.question);
    if (!question) {
      const fallback = buildFallbackQuestion({
        roleFamily: this.contextPack?.role_family,
        section: this.state.section,
        askedQuestions: this.state.asked_questions,
        uncoveredMustHaves: computeCoverageStatus(this.state).uncovered,
      });
      question = sanitizeQuestionText(fallback.question);
      controller = {
        section: this.state.section,
        ...fallback,
      };
    }

    this.lastControllerMeta = controller;
    this.lastQuestion = question;
    this.state.asked_questions += 1;
    applyDeterministicGates(this.state);

    if (controller.end_interview || this.state.section === 'completed') {
      this.state.section = 'wrap_up';
    }

    this.transcript.push({
      role: 'assistant',
      by: this.botName,
      text: question,
      ts: nowIso(),
      section: this.state.section,
      stage: 'controller',
      meta: controller,
    });

    await this.persistProgress();
    return question;
  }

  buildFallbackFinal() {
    const coverage = buildCoverageSummary(this.state);
    const competencies = toArray(coverage.competency);
    const avg = competencies.length
      ? competencies.reduce((sum, c) => sum + Number(c.score || 0), 0) / competencies.length
      : 0;

    const overallWeighted = clampNumber(Number(avg.toFixed(2)), 0, 4);
    const confidence = clampNumber(
      Number(
        (
          competencies.reduce((sum, c) => sum + Number(c.confidence || 0), 0) /
          Math.max(1, competencies.length)
        ).toFixed(2),
      ),
      0,
      1,
    );

    let recommendation = 'hold';
    if (overallWeighted >= 3.6 && confidence >= 0.6) recommendation = 'strong_hire';
    else if (overallWeighted >= 3.0) recommendation = 'hire';
    else if (overallWeighted < 2.2) recommendation = 'no_hire';

    return {
      overall_weighted_score: overallWeighted,
      confidence,
      competency_scores: competencies,
      must_have_coverage: toArray(coverage.must_have),
      strengths: ['Consistent baseline communication and technical reasoning.'],
      risks: toArray(coverage.must_have)
        .filter((m) => !m.covered)
        .map((m) => `Uncovered must-have: ${m.must_have}`),
      recommendation,
      summary: `Final evaluation completed with ${computeCoverageStatus(this.state).covered}/${computeCoverageStatus(this.state).total} must-haves covered.`,
    };
  }

  async finalize() {
    if (this.finalized) return null;
    this.finalized = true;

    const coverageSummary = buildCoverageSummary(this.state);
    const finalResult = await runFinalEvaluator({
      llmService: this.llmService,
      positionConfig: this.contextPack,
      finalState: this.state,
      evidenceLog: toArray(this.state.evidence_log),
      mustHaveCoverage: toArray(coverageSummary.must_have),
      competencyCoverage: toArray(coverageSummary.competency),
      contradictions: toArray(this.state.contradictions),
      answerQualityStats: this.state.answer_quality_stats,
      transcriptSummary: this.transcript.slice(-25).map((t) => ({
        role: t.role,
        section: t.section,
        text: firstSentence(t.text),
      })),
      candidateName: this.contextPack?.candidate_name,
    }).catch(() => this.buildFallbackFinal());

    const merged = finalResult || this.buildFallbackFinal();

    const overallWeightedScore = clampNumber(Number(merged.overall_weighted_score || 0), 0, 4);
    const rubricScore = clampNumber(Number(((overallWeightedScore / 4) * 10).toFixed(1)), 0, 10);
    const interviewScore = clampNumber(Math.round((overallWeightedScore / 4) * 100), 0, 100);
    const recommendation = normalizeRecommendation(String(merged.recommendation || 'hold'));

    const summaryFeedback = String(merged.summary || '').trim() || 'Interview finalized with structured evaluation.';
    const detailedFeedback = [
      `Strengths: ${toArray(merged.strengths).join('; ') || 'N/A'}`,
      `Risks: ${toArray(merged.risks).join('; ') || 'N/A'}`,
      `Confidence: ${clampNumber(Number(merged.confidence || 0), 0, 1)}`,
    ].join(' ');

    const update = {
      status: 'completed',
      meetingActualEnd: nowIso(),
      summaryFeedback,
      detailedFeedback,
      recommendation,
      interviewScore,
      rubricScore,
      overallWeightedScore,
      nextSteps:
        recommendation === 'strong_hire' || recommendation === 'hire'
          ? 'Proceed to next interview stage and validate role-specific depth with practical scenario discussion.'
          : 'Run targeted follow-up interview focusing on uncovered must-haves and identified risk areas.',
      engineState: this.state,
      engineTranscript: this.transcript.slice(-240),
      engineScores: {
        final: merged,
        coverageSummary,
      },
    };

    await this.persist(update);
    return update;
  }

  async persistProgress() {
    await this.persist({
      engineState: this.state,
      engineTranscript: this.transcript.slice(-140),
      engineScores: {
        coverageSummary: buildCoverageSummary(this.state),
        contradictions: toArray(this.state.contradictions).slice(-20),
      },
    });
  }

  async persist(updates) {
    await patchInterviewByRoomName(this.roomName, updates);
  }
}

module.exports = {
  InterviewEngine,
};
