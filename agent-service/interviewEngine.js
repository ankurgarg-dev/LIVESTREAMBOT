const { getInterviewByRoomName, patchInterviewByRoomName } = require('./interviewStoreClient');

const DEFAULT_STAGE_LIMIT = 4;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pickStages(positionSnapshot, fallbackTitle) {
  const mustHaves = Array.isArray(positionSnapshot?.must_haves)
    ? positionSnapshot.must_haves.filter(Boolean)
    : [];
  const focusAreas = Array.isArray(positionSnapshot?.focus_areas)
    ? positionSnapshot.focus_areas.filter(Boolean)
    : [];

  const seeds = [...mustHaves, ...focusAreas];
  const unique = Array.from(new Set(seeds.map((item) => String(item).trim()).filter(Boolean)));

  if (unique.length === 0) {
    return [
      `core fundamentals for ${fallbackTitle || 'the role'}`,
      'problem solving and tradeoffs',
      'system design and scalability',
    ];
  }

  return unique.slice(0, DEFAULT_STAGE_LIMIT);
}

function scoreAnswer(answer, skill) {
  const normalized = String(answer || '').toLowerCase();
  const words = normalized.split(/\s+/g).filter(Boolean);
  const keywordHits = String(skill || '')
    .toLowerCase()
    .split(/[\s/_-]+/g)
    .filter(Boolean)
    .reduce((sum, token) => sum + (normalized.includes(token) ? 1 : 0), 0);

  const depthSignal = clamp(words.length / 55, 0, 1);
  const coverageSignal = clamp(keywordHits / 3, 0, 1);
  const total = clamp(Math.round((depthSignal * 0.6 + coverageSignal * 0.4) * 5), 1, 5);

  return {
    score: total,
    notes:
      total >= 4
        ? 'Strong depth and relevant examples.'
        : total >= 3
          ? 'Reasonable response with moderate detail.'
          : 'Needs more concrete technical depth.',
  };
}

class InterviewEngine {
  constructor({ roomName, botName = 'Bristlecone AI Agent' }) {
    this.roomName = roomName;
    this.botName = botName;
    this.interview = null;
    this.startedAt = new Date().toISOString();
    this.state = {
      phase: 'intro',
      turn: 0,
      currentStageIndex: 0,
      askedQuestions: 0,
      completed: false,
      startedAt: this.startedAt,
    };
    this.stages = [];
    this.transcript = [];
    this.answers = [];
    this.lastQuestion = '';
  }

  async init() {
    const interview = await getInterviewByRoomName(this.roomName);
    this.interview = interview;
    const title = interview?.positionSnapshot?.role_title || interview?.jobTitle || 'Software Engineer';
    this.stages = pickStages(interview?.positionSnapshot, title);

    await this.persist({
      meetingActualStart: interview?.meetingActualStart || new Date().toISOString(),
      participantsJoined: interview?.participantsJoined || '',
      engineState: this.state,
      enginePlan: {
        title,
        stages: this.stages,
      },
    });
  }

  getSystemPrompt() {
    const position = this.interview?.positionSnapshot;
    const candidateName = this.interview?.candidateName || 'Candidate';
    const interviewerName = this.interview?.interviewerName || 'Interviewer';
    const roleTitle = position?.role_title || this.interview?.jobTitle || 'Software Engineer';
    const level = position?.level || 'mid';
    const roundType = position?.interview_round_type || 'standard';
    const mustHaves = Array.isArray(position?.must_haves) ? position.must_haves.join(', ') : '';
    const focusAreas = Array.isArray(position?.focus_areas) ? position.focus_areas.join(', ') : '';
    const notes = position?.notes_for_interviewer || this.interview?.notes || '';

    return [
      'You are an AI interview engine conducting a structured live technical interview.',
      'Behavior: concise, professional, conversational, no markdown.',
      `Interview context: candidate=${candidateName}, interviewer=${interviewerName}, role=${roleTitle}, level=${level}, round=${roundType}.`,
      `Primary skills to assess: ${mustHaves || 'core technical fundamentals'}.`,
      `Focus areas: ${focusAreas || 'problem solving, technical communication, system thinking'}.`,
      `Moderator notes: ${notes || 'none'}.`,
      'You must ask one interview question at a time, wait for candidate response, then ask the next targeted question.',
      'Do not answer your own questions. Do not give long explanations unless clarifying question intent.',
      'If candidate response is short or vague, ask a precise follow-up.',
      'When interview is near completion and instructed to wrap up, summarize key observations briefly.',
    ].join(' ');
  }

  getKickoffInput() {
    const candidate = this.interview?.candidateName || 'there';
    this.lastQuestion = `Thanks for joining, ${candidate}. Let us begin with a quick introduction and then technical questions. Could you briefly walk me through your recent relevant work?`;
    this.state.phase = 'intro';
    this.state.askedQuestions += 1;
    return this.lastQuestion;
  }

  onCandidateUtterance(text, sourceIdentity = 'participant') {
    const cleaned = String(text || '').trim();
    if (!cleaned) return;
    this.state.turn += 1;
    this.transcript.push({
      role: 'candidate',
      by: sourceIdentity,
      text: cleaned,
      ts: new Date().toISOString(),
      phase: this.state.phase,
    });

    const currentSkill =
      this.stages[this.state.currentStageIndex] || this.stages[this.stages.length - 1] || 'general technical depth';
    const scoring = scoreAnswer(cleaned, currentSkill);
    this.answers.push({
      skill: currentSkill,
      score: scoring.score,
      notes: scoring.notes,
      answer: cleaned,
      question: this.lastQuestion,
    });
  }

  buildRuntimeInstruction() {
    if (this.state.completed) {
      return 'Interview is complete. Keep response as a short closure only.';
    }

    if (this.state.phase === 'intro') {
      this.state.phase = 'technical';
      const skill = this.stages[this.state.currentStageIndex] || 'core fundamentals';
      return `Ask your first targeted technical question focused on: ${skill}. Keep it concise and practical.`;
    }

    if (this.state.phase === 'technical') {
      const totalQuestionsTarget = Math.max(3, this.stages.length + 1);
      if (this.state.askedQuestions >= totalQuestionsTarget) {
        this.state.phase = 'wrapup';
        return 'Interview question budget reached. Ask one short closing question about tradeoffs or improvements, then transition to wrap-up.';
      }

      const currentSkill = this.stages[this.state.currentStageIndex] || this.stages[this.stages.length - 1];
      this.state.currentStageIndex = Math.min(this.state.currentStageIndex + 1, this.stages.length - 1);
      return `Acknowledge briefly, then ask the next interview question focused on: ${currentSkill}.`;
    }

    if (this.state.phase === 'wrapup') {
      this.state.completed = true;
      this.state.phase = 'completed';
      return 'Provide a concise closing statement: thank candidate and state interview is complete.';
    }

    return 'Respond briefly and professionally.';
  }

  onAssistantResponse(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return;
    this.transcript.push({
      role: 'assistant',
      by: this.botName,
      text: cleaned,
      ts: new Date().toISOString(),
      phase: this.state.phase,
    });

    this.lastQuestion = cleaned;
    this.state.askedQuestions += 1;
  }

  buildFinalEvaluation() {
    const scored = this.answers.filter((item) => Number.isFinite(item.score));
    const avg = scored.length
      ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length
      : 0;
    const interviewScore = clamp(Math.round((avg / 5) * 100), 0, 100);
    const rubricScore = clamp(Number((avg * 2).toFixed(1)), 0, 10);

    let recommendation = 'hold';
    if (interviewScore >= 78) recommendation = 'strong_hire';
    else if (interviewScore >= 64) recommendation = 'hire';
    else if (interviewScore < 45) recommendation = 'no_hire';

    const strengths = scored
      .filter((item) => item.score >= 4)
      .slice(0, 3)
      .map((item) => item.skill);
    const gaps = scored
      .filter((item) => item.score <= 2)
      .slice(0, 3)
      .map((item) => item.skill);

    const summaryFeedback = `Interview completed for ${this.interview?.candidateName || 'candidate'} on ${
      this.interview?.jobTitle || this.interview?.positionSnapshot?.role_title || 'role'
    }. Overall score ${interviewScore}/100 with recommendation ${recommendation}.`;

    const detailedFeedback = [
      `Assessed stages: ${this.stages.join(', ')}`,
      strengths.length ? `Strengths: ${strengths.join(', ')}` : 'Strengths: moderate baseline communication and technical understanding.',
      gaps.length ? `Gaps: ${gaps.join(', ')}` : 'Gaps: no critical gaps observed in sampled responses.',
      `Total captured answers: ${this.answers.length}`,
    ].join(' ');

    return {
      status: 'completed',
      meetingActualEnd: new Date().toISOString(),
      summaryFeedback,
      detailedFeedback,
      rubricScore,
      interviewScore,
      recommendation,
      nextSteps:
        recommendation === 'strong_hire' || recommendation === 'hire'
          ? 'Proceed to next stage with focused system design and production depth checks.'
          : 'Consider follow-up probing round before final decision.',
      engineState: this.state,
      engineScores: {
        averageFivePoint: Number(avg.toFixed(2)),
        answers: this.answers,
      },
      engineTranscript: this.transcript,
    };
  }

  async persist(updates) {
    await patchInterviewByRoomName(this.roomName, updates);
  }

  async persistProgress() {
    await this.persist({
      engineState: this.state,
      engineTranscript: this.transcript.slice(-80),
      engineScores: {
        answers: this.answers.slice(-50),
      },
    });
  }

  async finalize() {
    const payload = this.buildFinalEvaluation();
    await this.persist(payload);
    return payload;
  }
}

module.exports = {
  InterviewEngine,
};

