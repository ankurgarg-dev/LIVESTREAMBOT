class BaseLivekitAgent {
  constructor({ roomName, persistedPromptTemplates, deps }) {
    this.roomName = roomName;
    this.persistedPromptTemplates = persistedPromptTemplates;
    this.deps = deps;
    this.runtimeInstruction = deps.firstNonEmptyText(
      process.env.OPENAI_INTERVIEW_RUNTIME_INSTRUCTION,
      persistedPromptTemplates?.classicPrompt,
    );
  }

  get agentType() {
    return this.deps.AGENT_TYPE_CLASSIC;
  }

  get identity() {
    return this.deps.botIdentityForRoom(this.roomName, this.agentType);
  }

  get botName() {
    return this.deps.BOT_NAME;
  }

  getLlmModel() {
    return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  getLlmFallbackModel() {
    return '';
  }

  buildRuntimeInstruction({ candidateContext, roleContext }) {
    return this.deps.buildInterviewRuntimeInstruction({
      candidateContext,
      roleContext,
      basePrompt: this.runtimeInstruction,
    });
  }

  async onParticipantConnected({ participant, state, queueUserTurn, ensureInterviewStarted, stop }) {
    if (!this.deps.isBotIdentity(participant.identity) && this.deps.INTERVIEW_MODE && !state.kickoffSent) {
      state.kickoffSent = true;
      queueUserTurn('__bootstrap_interview_start__', 'agent_bootstrap');
    }
    if (!this.deps.isBotIdentity(participant.identity)) {
      state.candidateEverJoined = true;
      ensureInterviewStarted().catch(() => undefined);
    }
    return { stop };
  }
}

class ClassicLivekitAgent extends BaseLivekitAgent {}

class RealtimeScreeningLivekitAgent extends BaseLivekitAgent {
  constructor(options) {
    super(options);
    this.runtimeInstruction = this.deps.firstNonEmptyText(
      process.env.OPENAI_REALTIME_SCREENING_RUNTIME_INSTRUCTION,
      options?.persistedPromptTemplates?.realtimePrompt,
    );
  }

  get agentType() {
    return this.deps.AGENT_TYPE_REALTIME_SCREENING;
  }

  get botName() {
    return String(process.env.BOT_NAME_REALTIME_SCREENING || 'Bristlecone Realtime Screening Agent').trim();
  }

  getLlmModel() {
    return process.env.OPENAI_REALTIME_SCREENING_MODEL || 'gpt-realtime-mini';
  }

  getLlmFallbackModel() {
    return process.env.OPENAI_REALTIME_SCREENING_FALLBACK_MODEL || 'gpt-4o-mini';
  }

  buildRuntimeInstruction({ candidateContext, roleContext }) {
    return this.deps.buildRealtimeScreeningRuntimeInstruction({
      candidateContext,
      roleContext,
      basePrompt: this.runtimeInstruction,
    });
  }

  async onParticipantConnected({ participant, state, queueUserTurn, ensureInterviewStarted, stop }) {
    await super.onParticipantConnected({
      participant,
      state,
      queueUserTurn,
      ensureInterviewStarted,
      stop,
    });

    if (!this.deps.isBotIdentity(participant.identity) && !state.screeningHardStopTimer) {
      state.screeningHardStopTimer = setTimeout(() => {
        stop('screening_time_limit').catch((err) => {
          console.error(`[agent][${this.roomName}] screening stop failed:`, err);
        });
      }, this.deps.SCREENING_MAX_MINUTES * 60 * 1000);
    }
  }
}

function createLivekitAgent({ roomName, agentType, persistedPromptTemplates, deps }) {
  const normalizedType = deps.normalizeAgentType(agentType);
  if (normalizedType === deps.AGENT_TYPE_REALTIME_SCREENING) {
    return new RealtimeScreeningLivekitAgent({
      roomName,
      agentType,
      persistedPromptTemplates,
      deps,
    });
  }
  return new ClassicLivekitAgent({
    roomName,
    agentType,
    persistedPromptTemplates,
    deps,
  });
}

module.exports = {
  createLivekitAgent,
  BaseLivekitAgent,
  ClassicLivekitAgent,
  RealtimeScreeningLivekitAgent,
};
