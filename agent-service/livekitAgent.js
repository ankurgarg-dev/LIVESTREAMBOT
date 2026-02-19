require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const OpenAI = require('openai');
const { AccessToken } = require('livekit-server-sdk');
const {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  AudioFrame,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} = require('@livekit/rtc-node');

const { LLMService } = require('./llmService');
const { TTSService } = require('./ttsService');

const REQUIRED_ENV = ['OPENAI_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const TARGET_SAMPLE_RATE = 48000;
const TARGET_CHANNELS = 1;
const FRAME_DURATION_MS = 10;
const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
const TEXT_DECODER = new TextDecoder();
const STT_SAMPLE_RATE = 16000;
const STT_CHANNELS = 1;
const BOT_IDENTITY_BASE = (process.env.BOT_IDENTITY || 'bristlecone-ai-agent').trim();
const BOT_NAME = (process.env.BOT_NAME || 'Bristlecone AI Agent').trim();
const ROOM_IDLE_TIMEOUT_MS = Math.max(30000, Number(process.env.AGENT_ROOM_IDLE_TIMEOUT_MS || 180000));
const ENABLE_BARGE_IN = process.env.ENABLE_BARGE_IN !== 'false';
const EMPTY_ROOM_FINALIZE_DELAY_MS = Math.max(
  1000,
  Number(process.env.EMPTY_ROOM_FINALIZE_DELAY_MS || 6000),
);
const INTERVIEW_MODE = process.env.AGENT_INTERVIEW_MODE !== 'false';

class PcmAudioPump {
  constructor(audioSource, { frameSamples = FRAME_SAMPLES, maxQueueSeconds = 3 } = {}) {
    this.audioSource = audioSource;
    this.frameSamples = frameSamples;
    this.maxQueueSamples = TARGET_SAMPLE_RATE * maxQueueSeconds;

    this.chunks = [];
    this.totalSamples = 0;
    this.running = true;

    this.waitForDataResolvers = [];
    this.waitForSpaceResolvers = [];
    this.pumpTask = this._pump();
  }

  async writePcm16le(pcmBuffer) {
    if (!this.running) return;

    const sampleCount = Math.floor(pcmBuffer.length / 2);
    if (sampleCount === 0) return;

    const samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      samples[i] = pcmBuffer.readInt16LE(i * 2);
    }

    while (this.running && this.totalSamples + samples.length > this.maxQueueSamples) {
      await new Promise((resolve) => this.waitForSpaceResolvers.push(resolve));
    }

    if (!this.running) return;

    this.chunks.push({ samples, offset: 0 });
    this.totalSamples += samples.length;
    this._notifyData();
  }

  _notifyData() {
    const resolvers = this.waitForDataResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  _notifySpace() {
    const resolvers = this.waitForSpaceResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  async _readSamples(count) {
    while (this.running && this.totalSamples < count) {
      await new Promise((resolve) => this.waitForDataResolvers.push(resolve));
    }

    if (!this.running) return null;

    const out = new Int16Array(count);
    let writeOffset = 0;

    while (writeOffset < count && this.chunks.length > 0) {
      const head = this.chunks[0];
      const available = head.samples.length - head.offset;
      const needed = count - writeOffset;
      const take = Math.min(available, needed);

      out.set(head.samples.subarray(head.offset, head.offset + take), writeOffset);
      head.offset += take;
      writeOffset += take;
      this.totalSamples -= take;

      if (head.offset >= head.samples.length) {
        this.chunks.shift();
      }
    }

    this._notifySpace();
    return out;
  }

  async _pump() {
    while (this.running) {
      const frameSamples = await this._readSamples(this.frameSamples);
      if (!frameSamples) break;

      const frame = new AudioFrame(frameSamples, TARGET_SAMPLE_RATE, TARGET_CHANNELS, this.frameSamples);
      await this.audioSource.captureFrame(frame);
    }
  }

  async stop() {
    this.running = false;
    this._notifyData();
    this._notifySpace();
    await this.pumpTask.catch(() => undefined);
  }

  clear() {
    this.chunks = [];
    this.totalSamples = 0;
    this._notifySpace();
  }
}

function int16ToBufferLE(int16) {
  const out = Buffer.alloc(int16.length * 2);
  for (let i = 0; i < int16.length; i += 1) {
    out.writeInt16LE(int16[i], i * 2);
  }
  return out;
}

function concatInt16(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function pcm16MonoToWav(pcm, sampleRate) {
  const dataSize = pcm.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, int16ToBufferLE(pcm)]);
}

function frameRms(int16) {
  if (!int16 || int16.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < int16.length; i += 1) {
    const x = int16[i] / 32768;
    sumSq += x * x;
  }
  return Math.sqrt(sumSq / int16.length);
}

class TranscriptionService {
  constructor({ apiKey, model = 'gpt-4o-mini-transcribe', language }) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.language = language;
  }

  async transcribePcm16Mono({ samples, sampleRate }) {
    if (!samples || samples.length === 0) return '';
    const wav = pcm16MonoToWav(samples, sampleRate);
    const file = await OpenAI.toFile(wav, 'speech.wav', { type: 'audio/wav' });
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      response_format: 'json',
      ...(this.language ? { language: this.language } : {}),
    });
    return (result?.text ?? '').trim();
  }
}

class SpeechTurnDetector {
  constructor({
    transcriptionService,
    onTranscription,
    participantIdentity,
    rmsThreshold = Number(process.env.STT_VAD_RMS_THRESHOLD || 0.004),
    minSpeechMs = Number(process.env.STT_MIN_SPEECH_MS || 220),
    maxSilenceMs = Number(process.env.STT_MAX_SILENCE_MS || 1500),
    maxUtteranceMs = Number(process.env.STT_MAX_UTTERANCE_MS || 20000),
    minTranscribeMs = Number(process.env.STT_MIN_TRANSCRIBE_MS || 650),
  }) {
    this.transcriptionService = transcriptionService;
    this.onTranscription = onTranscription;
    this.participantIdentity = participantIdentity;

    this.rmsThreshold = rmsThreshold;
    this.minSpeechFrames = Math.max(1, Math.round(minSpeechMs / 20));
    this.maxSilenceFrames = Math.max(1, Math.round(maxSilenceMs / 20));
    this.maxUtteranceFrames = Math.max(1, Math.round(maxUtteranceMs / 20));
    this.minTranscribeSamples = Math.max(1, Math.floor((minTranscribeMs / 1000) * STT_SAMPLE_RATE));

    this.inSpeech = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.utteranceFrames = [];
    this.transcribing = false;
  }

  async pushFrame(frame) {
    const data = frame.data;
    if (!data || data.length === 0) return;

    const rms = frameRms(data);
    const isSpeechLike = rms >= this.rmsThreshold;

    if (isSpeechLike) {
      this.inSpeech = true;
      this.speechFrames += 1;
      this.silenceFrames = 0;
      this.utteranceFrames.push(new Int16Array(data));
      if (this.utteranceFrames.length >= this.maxUtteranceFrames) {
        await this.flush('max_utterance');
      }
      return;
    }

    if (!this.inSpeech) {
      return;
    }

    this.silenceFrames += 1;
    this.utteranceFrames.push(new Int16Array(data));

    if (this.silenceFrames >= this.maxSilenceFrames) {
      if (this.speechFrames >= this.minSpeechFrames) {
        await this.flush('silence');
      } else {
        this.reset();
      }
    }
  }

  async flush(reason = 'manual') {
    if (this.transcribing) return;
    const merged = concatInt16(this.utteranceFrames);
    this.reset();

    if (merged.length < this.minTranscribeSamples) {
      return;
    }

    this.transcribing = true;
    try {
      const text = await this.transcriptionService.transcribePcm16Mono({
        samples: merged,
        sampleRate: STT_SAMPLE_RATE,
      });

      if (!text) return;
      console.log(`[stt][${this.participantIdentity}] (${reason}) ${text}`);
      await this.onTranscription(text);
    } catch (err) {
      console.error(`[stt][${this.participantIdentity}] transcription error:`, err);
    } finally {
      this.transcribing = false;
    }
  }

  reset() {
    this.inSpeech = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.utteranceFrames = [];
  }
}

function normalizeLiveKitUrl(rawUrl) {
  const u = new URL(rawUrl);
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    throw new Error('LIVEKIT_URL must start with ws:// or wss://');
  }
  return u.toString();
}

function normalizeRoomName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function botIdentityForRoom(roomName) {
  const suffix = normalizeRoomName(roomName).slice(0, 32) || 'room';
  return `${BOT_IDENTITY_BASE}-${suffix}`;
}

function isBotIdentity(identity) {
  if (!identity) return false;
  return identity === BOT_IDENTITY_BASE || identity.startsWith(`${BOT_IDENTITY_BASE}-`);
}

function toHttpUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'ws:') u.protocol = 'http:';
    if (u.protocol === 'wss:') u.protocol = 'https:';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function getAppBaseUrl() {
  const explicit = String(process.env.AGENT_APP_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return toHttpUrl(process.env.LIVEKIT_URL || '');
}

function normalizeRecommendation(value) {
  const allowed = new Set(['strong_hire', 'hire', 'hold', 'no_hire']);
  return allowed.has(String(value || '').trim()) ? String(value).trim() : 'hold';
}

function nowIso() {
  return new Date().toISOString();
}

function buildInterviewRuntimeInstruction({ candidateContext = '', roleContext = '' } = {}) {
  const contextLines = [];
  if (candidateContext) contextLines.push(`Candidate context: ${candidateContext}`);
  if (roleContext) contextLines.push(`Role context: ${roleContext}`);
  const contextBlock = contextLines.length ? `\n\nKnown context:\n${contextLines.join('\n')}` : '';

  return [
    'You are a human-like technical interviewer in a live voice call.',
    'Do not behave like a rigid state machine.',
    'Run a soft interview flow naturally:',
    '1) Start with a warm intro, set expectations, and ask for consent to begin.',
    '2) Ask about candidate background and experience relevant to role.',
    '3) Deep dive into one or two concrete projects from the candidate CV/background.',
    '4) Ask strong theoretical and practical follow-up questions tied to technologies from those projects.',
    '5) End with a brief wrap-up and invite candidate questions.',
    'Guidelines:',
    '- Keep it conversational and adaptive.',
    '- Ask one primary question at a time; short acknowledgement is fine.',
    '- If candidate says they do not know, acknowledge and move forward gracefully.',
    '- Avoid repeating the exact same question.',
    '- Keep spoken responses concise and natural.',
    '- Stay focused on interview content; do not drift to unrelated chit-chat.',
  ].join(' ') + contextBlock;
}

async function createJoinToken({ roomName, identity, name }) {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '1h',
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return token.toJwt();
}

async function createAgentSession(roomName, { interactiveStdin = false, onStop } = {}) {
  const livekitUrl = normalizeLiveKitUrl(process.env.LIVEKIT_URL);
  const identity = botIdentityForRoom(roomName);
  const token = await createJoinToken({ roomName, identity, name: BOT_NAME });

  const room = new Room();
  let stopping = false;
  let stopped = false;
  let idleTimer = null;
  let emptyRoomStopTimer = null;
  let kickoffSent = false;
  let interviewStarted = false;
  let candidateEverJoined = false;
  let interviewStartedAt = '';
  let finalReportPublished = false;
  let interviewId = '';
  const transcript = [];

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log(`[room:${roomName}] participant connected: ${participant.identity}`);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (emptyRoomStopTimer) {
      clearTimeout(emptyRoomStopTimer);
      emptyRoomStopTimer = null;
    }
    if (!isBotIdentity(participant.identity) && INTERVIEW_MODE && !kickoffSent) {
      kickoffSent = true;
      queueUserTurn('__bootstrap_interview_start__', 'agent_bootstrap');
    }
    if (!isBotIdentity(participant.identity)) {
      candidateEverJoined = true;
      ensureInterviewStarted().catch(() => undefined);
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.log(`[room:${roomName}] participant disconnected: ${participant.identity}`);
    if (emptyRoomStopTimer) {
      clearTimeout(emptyRoomStopTimer);
      emptyRoomStopTimer = null;
    }
    if (room.remoteParticipants.size === 0) {
      emptyRoomStopTimer = setTimeout(() => {
        stop('room_empty').catch((err) => {
          console.error(`[agent][${roomName}] empty room stop failed:`, err);
        });
      }, EMPTY_ROOM_FINALIZE_DELAY_MS);
    }
    scheduleIdleStop();
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log(`[room:${roomName}] disconnected`);
  });

  let audioPump = null;

  const llmService = new LLMService({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    systemPrompt: process.env.OPENAI_SYSTEM_PROMPT || undefined,
  });

  const ttsService = new TTSService({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: process.env.OPENAI_TTS_VOICE || 'coral',
  });

  const transcriptionService = new TranscriptionService({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
    language: process.env.OPENAI_STT_LANGUAGE || undefined,
  });
  let candidateContext = String(
    process.env.CANDIDATE_CV_TEXT || process.env.OPENAI_CV_CONTEXT_TEXT || process.env.OPENAI_CANDIDATE_CONTEXT || '',
  )
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 4000);
  let roleContext = String(process.env.OPENAI_ROLE_CONTEXT || process.env.JOB_CONTEXT_TEXT || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 2500);
  const fallbackRuntimeInstruction = String(
    process.env.OPENAI_RUNTIME_INSTRUCTION ||
      'Have a natural spoken conversation. Keep responses brief, clear, and friendly.',
  );

  const activeInputStreams = new Map();
  let assistantState = 'idle'; // idle | thinking | speaking
  let interruptRequested = false;
  let latestInputSeq = 0;
  let processingInputQueue = false;
  let queueWorker = Promise.resolve();
  const inputQueue = [];
  const appBaseUrl = getAppBaseUrl();

  const appendTranscript = (entry) => {
    transcript.push(entry);
    if (transcript.length > 220) transcript.splice(0, transcript.length - 220);
  };

  const fetchLatestInterviewByRoom = async () => {
    if (!appBaseUrl) return null;
    const res = await fetch(`${appBaseUrl}/api/interviews`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`list interviews failed (${res.status})`);
    const json = await res.json();
    const items = Array.isArray(json?.interviews) ? json.interviews : [];
    return (
      items
        .filter((x) => String(x?.roomName || '').trim().toLowerCase() === roomName.toLowerCase())
        .sort((a, b) => String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || '')))[0] ||
      null
    );
  };

  const patchInterview = async (id, payload) => {
    if (!appBaseUrl || !id) return null;
    const res = await fetch(`${appBaseUrl}/api/interviews/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`patch interview failed (${res.status})`);
    const json = await res.json();
    return json?.interview || null;
  };

  const persistLocalFallbackReport = async (report) => {
    const outDir = process.env.AGENT_REPORT_DIR || path.join('/tmp', 'bristlecone-agent-reports');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${roomName}-${Date.now()}.json`);
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[agent][${roomName}] wrote fallback report to ${outPath}`);
  };

  const ensureInterviewStarted = async () => {
    if (interviewStarted) return;
    interviewStarted = true;
    interviewStartedAt = nowIso();
    try {
      const latest = await fetchLatestInterviewByRoom();
      if (!latest?.id) return;
      interviewId = latest.id;
      await patchInterview(interviewId, {
        meetingActualStart: interviewStartedAt,
      });
    } catch (err) {
      console.warn(`[agent][${roomName}] failed to mark interview start:`, err?.message || err);
    }
  };

  const buildFallbackAssessment = (stopReason) => {
    const turnCount = transcript.filter((t) => t.role === 'candidate').length;
    return {
      summaryFeedback: `Interview ended (${stopReason}) after ${turnCount} candidate turns. Report generated from available conversation.`,
      detailedFeedback:
        'Strengths: communication observed in conversation. Risks: limited structured evidence due to partial/non-deterministic interview flow.',
      recommendation: 'hold',
      interviewScore: turnCount >= 8 ? 68 : turnCount >= 4 ? 58 : 48,
      rubricScore: turnCount >= 8 ? 6.8 : turnCount >= 4 ? 5.8 : 4.8,
      nextSteps: 'Schedule targeted follow-up focusing on depth, architecture tradeoffs, and measurable impact examples.',
    };
  };

  const evaluateInterview = async (stopReason) => {
    const candidateTurns = transcript
      .filter((t) => t.role === 'candidate')
      .slice(-40)
      .map((t) => ({ ts: t.ts, by: t.by, text: t.text }));
    const assistantTurns = transcript
      .filter((t) => t.role === 'assistant')
      .slice(-40)
      .map((t) => ({ ts: t.ts, text: t.text }));

    if (candidateTurns.length === 0) {
      return buildFallbackAssessment(stopReason);
    }

    const prompt = [
      'Generate a concise interview assessment report as strict JSON only.',
      'The interview may be incomplete. Use only available evidence and mention uncertainty if needed.',
      `Stop reason: ${stopReason}`,
      `Candidate turns (${candidateTurns.length}): ${JSON.stringify(candidateTurns)}`,
      `Assistant turns (${assistantTurns.length}): ${JSON.stringify(assistantTurns)}`,
      'Return schema:',
      '{',
      '  "summaryFeedback": "string <= 260 chars",',
      '  "detailedFeedback": "string with strengths and risks",',
      '  "recommendation": "strong_hire|hire|hold|no_hire",',
      '  "interviewScore": number 0-100,',
      '  "rubricScore": number 0-10,',
      '  "nextSteps": "string"',
      '}',
    ].join('\n');

    try {
      const raw = await llmService.callJson(prompt, {
        model: process.env.OPENAI_EVAL_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
      });
      const fallback = buildFallbackAssessment(stopReason);
      return {
        summaryFeedback: String(raw?.summaryFeedback || '').slice(0, 260) || fallback.summaryFeedback,
        detailedFeedback: String(raw?.detailedFeedback || '').slice(0, 2000) || fallback.detailedFeedback,
        recommendation: normalizeRecommendation(raw?.recommendation),
        interviewScore: Math.max(0, Math.min(100, Number(raw?.interviewScore || 0) || 0)),
        rubricScore: Math.max(0, Math.min(10, Number(raw?.rubricScore || 0) || 0)),
        nextSteps: String(raw?.nextSteps || '').slice(0, 500) || fallback.nextSteps,
      };
    } catch (err) {
      console.warn(`[agent][${roomName}] evaluation generation failed:`, err?.message || err);
      return buildFallbackAssessment(stopReason);
    }
  };

  const publishFinalReport = async (stopReason) => {
    if (finalReportPublished || !candidateEverJoined) return;
    if (!interviewStarted) {
      await ensureInterviewStarted().catch(() => undefined);
    }
    if (!interviewStarted) return;
    finalReportPublished = true;
    const assessment = await evaluateInterview(stopReason);
    const update = {
      status: 'completed',
      meetingActualStart: interviewStartedAt || nowIso(),
      meetingActualEnd: nowIso(),
      summaryFeedback: assessment.summaryFeedback,
      detailedFeedback: assessment.detailedFeedback,
      recommendation: normalizeRecommendation(assessment.recommendation),
      interviewScore: Math.round(Number(assessment.interviewScore || 0)),
      rubricScore: Number(Number(assessment.rubricScore || 0).toFixed(1)),
      nextSteps: assessment.nextSteps,
    };

    try {
      if (!interviewId) {
        const latest = await fetchLatestInterviewByRoom();
        interviewId = latest?.id || '';
      }
      if (interviewId) {
        await patchInterview(interviewId, update);
        console.log(`[agent][${roomName}] published interview report for ${interviewId}`);
        return;
      }
      await persistLocalFallbackReport({ roomName, stopReason, ...update, transcript: transcript.slice(-120) });
    } catch (err) {
      console.warn(`[agent][${roomName}] report publish failed:`, err?.message || err);
      await persistLocalFallbackReport({ roomName, stopReason, ...update, transcript: transcript.slice(-120) }).catch(() => undefined);
    }
  };

  const extractPayload = (payload) => {
    try {
      const raw = TEXT_DECODER.decode(payload).trim();
      if (!raw) return { text: null, contextUpdated: false };

      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        let contextUpdated = false;
        const ctx = parsed?.context || {};
        const cv = parsed?.cv || parsed?.resume || parsed?.candidate_cv || ctx?.cv || ctx?.resume || '';
        const role = parsed?.role || parsed?.job || parsed?.position || ctx?.role || ctx?.job || '';
        if (typeof cv === 'string' && cv.trim()) {
          candidateContext = cv.trim().replace(/\s+/g, ' ').slice(0, 4000);
          contextUpdated = true;
        }
        if (typeof role === 'string' && role.trim()) {
          roleContext = role.trim().replace(/\s+/g, ' ').slice(0, 2500);
          contextUpdated = true;
        }

        const maybeText =
          parsed?.text ??
          parsed?.message ??
          parsed?.content ??
          parsed?.body?.text ??
          parsed?.payload?.text;
        return {
          text: typeof maybeText === 'string' ? maybeText.trim() : null,
          contextUpdated,
        };
      }

      return { text: raw, contextUpdated: false };
    } catch {
      return { text: null, contextUpdated: false };
    }
  };

  const processUserInput = async (text, sourceIdentity = 'participant', seq = 0) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage =
      sourceIdentity === 'agent_bootstrap'
        ? 'Start the interview now with a warm intro, set expectations, and ask for consent to begin.'
        : trimmed;
    const runtimeInstruction = INTERVIEW_MODE
      ? buildInterviewRuntimeInstruction({ candidateContext, roleContext })
      : fallbackRuntimeInstruction;

    if (sourceIdentity !== 'agent_bootstrap') {
      console.log(`\n[user][${roomName}] ${trimmed}`);
      appendTranscript({ role: 'candidate', by: sourceIdentity, text: trimmed, ts: nowIso() });
    }
    assistantState = 'thinking';
    interruptRequested = false;
    process.stdout.write(`[assistant][${roomName}] `);

    if (seq > 0 && seq < latestInputSeq) {
      assistantState = 'idle';
      return;
    }

    let assistantText = '';
    const llmDeltaStream = llmService.streamAssistantReply(userMessage, {
      runtimeInstruction,
    });
    const guardedLlmDeltaStream = (async function* guarded() {
      for await (const delta of llmDeltaStream) {
        if (interruptRequested || (seq > 0 && seq < latestInputSeq)) break;
        assistantText += delta;
        process.stdout.write(delta);
        yield delta;
      }
      process.stdout.write('\n');
    })();

    assistantState = 'speaking';
    while (!audioPump) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for await (const pcmChunk of ttsService.streamFromLlmText(guardedLlmDeltaStream)) {
      if (interruptRequested || (seq > 0 && seq < latestInputSeq)) break;
      await audioPump.writePcm16le(pcmChunk);
    }
    if (assistantText.trim()) {
      appendTranscript({ role: 'assistant', by: BOT_NAME, text: assistantText.trim(), ts: nowIso() });
    }
    assistantState = 'idle';
  };

  const drainInputQueue = async () => {
    if (processingInputQueue) return;
    processingInputQueue = true;
    try {
      while (inputQueue.length > 0) {
        const next = inputQueue.shift();
        await processUserInput(next.text, next.sourceIdentity, next.seq);
      }
    } finally {
      processingInputQueue = false;
    }
  };

  const queueUserTurn = (text, sourceIdentity = 'participant') => {
    const cleaned = String(text || '').trim();
    if (!cleaned) return;

    latestInputSeq += 1;
    inputQueue.push({
      text: cleaned,
      sourceIdentity: sourceIdentity || 'participant',
      seq: latestInputSeq,
    });

    if (ENABLE_BARGE_IN && assistantState !== 'idle') {
      interruptRequested = true;
      if (audioPump) audioPump.clear();
    }

    queueWorker = queueWorker.then(drainInputQueue).catch((err) => {
      assistantState = 'idle';
      console.error(`[agent][${roomName}] generation error:`, err);
    });
  };

  const startRemoteAudioTranscription = (track, participant) => {
    const streamKey = `${participant.identity}:${track.sid ?? 'audio'}`;
    if (activeInputStreams.has(streamKey)) return;

    const stream = new AudioStream(track, {
      sampleRate: STT_SAMPLE_RATE,
      numChannels: STT_CHANNELS,
      frameSizeMs: 20,
    });
    const reader = stream.getReader();

    const turnDetector = new SpeechTurnDetector({
      transcriptionService,
      participantIdentity: participant.identity,
      onTranscription: async (text) => {
        queueUserTurn(text, participant.identity);
      },
    });

    const readLoop = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          await turnDetector.pushFrame(value);
        }
      } catch (err) {
        console.error(`[stt][${roomName}][${participant.identity}] audio stream error:`, err);
      } finally {
        await turnDetector.flush('stream_end');
      }
    })();

    activeInputStreams.set(streamKey, {
      reader,
      turnDetector,
      readLoop,
    });

    console.log(`[stt][${roomName}] subscribed to audio for '${participant.identity}'`);
  };

  const handleDataReceived = (payload, participant) => {
    if (!participant) return;
    if (isBotIdentity(participant.identity)) return;

    const parsed = extractPayload(payload);
    const text = parsed.text;
    if (parsed.contextUpdated) {
      console.log(`[agent][${roomName}] updated candidate/role context from data payload`);
    }
    if (!text) return;

    console.log(`\n[data][${roomName}][${participant.identity}] ${text}`);
    queueUserTurn(text, participant.identity);
  };

  const handleTrackSubscribed = (track, publication, participant) => {
    if (!participant || isBotIdentity(participant.identity)) return;
    if (!(track instanceof RemoteAudioTrack)) return;

    startRemoteAudioTranscription(track, participant);
  };

  const handleTrackUnsubscribed = async (track, publication, participant) => {
    if (!participant || isBotIdentity(participant.identity)) return;
    const streamKey = `${participant.identity}:${track.sid ?? 'audio'}`;
    const active = activeInputStreams.get(streamKey);
    if (!active) return;

    activeInputStreams.delete(streamKey);
    try {
      await active.reader.cancel();
    } catch {
      // Ignore reader cancellation errors during teardown.
    }
  };

  room.on(RoomEvent.DataReceived, handleDataReceived);
  room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

  await room.connect(livekitUrl, token);
  console.log(`[agent] connected to room '${roomName}' as '${identity}'`);

  const audioSource = new AudioSource(TARGET_SAMPLE_RATE, TARGET_CHANNELS);
  const localTrack = LocalAudioTrack.createAudioTrack('ai-agent-audio', audioSource);
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(localTrack, publishOptions);
  console.log(`[agent] published audio track in '${roomName}'`);

  audioPump = new PcmAudioPump(audioSource);

  if (process.env.SIMULATED_INPUT && process.env.SIMULATED_INPUT.trim()) {
    queueUserTurn(process.env.SIMULATED_INPUT, 'simulated');
  }

  let rl = null;
  if (interactiveStdin && process.env.ENABLE_STDIN !== 'false') {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    console.log(`[agent] stdin enabled for room '${roomName}'`);
    rl.on('line', (line) => {
      queueUserTurn(line, 'stdin');
    });
  }

  const stop = async (reason = 'manual') => {
    if (stopped || stopping) return;
    stopping = true;
    console.log(`[agent] stopping room '${roomName}' (${reason})`);

    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (emptyRoomStopTimer) {
      clearTimeout(emptyRoomStopTimer);
      emptyRoomStopTimer = null;
    }
    if (rl) {
      rl.close();
      rl = null;
    }

    room.off(RoomEvent.DataReceived, handleDataReceived);
    room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    for (const active of activeInputStreams.values()) {
      try {
        await active.reader.cancel();
      } catch {
        // Ignore cancellation errors during shutdown.
      }
    }
    activeInputStreams.clear();

    await queueWorker.catch(() => undefined);
    await publishFinalReport(reason).catch((err) => {
      console.warn(`[agent][${roomName}] publishFinalReport failed:`, err?.message || err);
    });
    if (audioPump) {
      await audioPump.stop();
    }

    try {
      await room.disconnect();
    } catch (err) {
      console.error(`[agent][${roomName}] room disconnect error:`, err);
    }

    stopped = true;
    stopping = false;
    if (onStop) onStop(roomName);
  };

  const scheduleIdleStop = () => {
    if (stopping || stopped || ROOM_IDLE_TIMEOUT_MS <= 0) return;
    if (room.remoteParticipants.size > 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stop('idle_timeout').catch((err) => {
        console.error(`[agent][${roomName}] idle stop failed:`, err);
      });
    }, ROOM_IDLE_TIMEOUT_MS);
  };

  scheduleIdleStop();

  return {
    roomName,
    identity,
    stop,
    hasParticipants: () => room.remoteParticipants.size > 0,
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function startManager() {
  normalizeLiveKitUrl(process.env.LIVEKIT_URL);

  const sessions = new Map();
  const pendingJoins = new Map();
  let shuttingDown = false;
  const resetSessionOnJoin =
    process.env.AGENT_RESET_SESSION_ON_JOIN === 'true' ||
    process.env.AGENT_RESET_SESSION_ON_JOIN === '1';

  const ensureSession = async (roomName, { interactiveStdin = false, reason = 'api' } = {}) => {
    const normalized = normalizeRoomName(roomName);
    if (!normalized) {
      throw new Error('roomName is required');
    }

    const shouldResetExisting =
      resetSessionOnJoin && (reason === 'control-api' || reason === 'startup-default-room');

    if (sessions.has(normalized)) {
      if (!shouldResetExisting) {
        return { roomName: normalized, status: 'already_joined' };
      }

      const existing = sessions.get(normalized);
      sessions.delete(normalized);
      if (existing && typeof existing.stop === 'function') {
        await existing.stop('reset_on_join').catch((err) => {
          console.error(`[agent-manager] failed to reset room '${normalized}':`, err);
        });
      }
    }

    if (pendingJoins.has(normalized)) {
      await pendingJoins.get(normalized);
      if (sessions.has(normalized) && !shouldResetExisting) {
        return { roomName: normalized, status: 'already_joined' };
      }
    }

    console.log(`[agent-manager] joining room '${normalized}' (reason: ${reason})`);

    const joinTask = createAgentSession(normalized, {
      interactiveStdin,
      onStop: (name) => {
        sessions.delete(name);
        console.log(`[agent-manager] room session removed: '${name}'`);
      },
    })
      .then((session) => {
        sessions.set(normalized, session);
      })
      .finally(() => {
        pendingJoins.delete(normalized);
      });

    pendingJoins.set(normalized, joinTask);
    await joinTask;

    return { roomName: normalized, status: 'joined' };
  };

  const controlEnabled = process.env.AGENT_CONTROL_ENABLED !== 'false';
  const controlHost = process.env.AGENT_CONTROL_HOST || '127.0.0.1';
  const controlPort = Number(process.env.AGENT_CONTROL_PORT || 8787);
  const controlToken = String(process.env.AGENT_CONTROL_TOKEN || '').trim();
  let controlServer = null;

  if (controlEnabled) {
    controlServer = http.createServer(async (req, res) => {
      try {
        if (!req.url) {
          sendJson(res, 400, { ok: false, error: 'Missing URL' });
          return;
        }

        if (controlToken) {
          const tokenHeader = String(req.headers['x-agent-token'] || '').trim();
          if (tokenHeader !== controlToken) {
            sendJson(res, 401, { ok: false, error: 'Unauthorized' });
            return;
          }
        }

        const path = req.url.split('?')[0];

        if (req.method === 'GET' && path === '/health') {
          sendJson(res, 200, {
            ok: true,
            rooms: Array.from(sessions.keys()),
            pendingRooms: Array.from(pendingJoins.keys()),
          });
          return;
        }

        if (req.method === 'POST' && path === '/join') {
          const body = await readJsonBody(req);
          const roomName = body?.roomName;
          const result = await ensureSession(roomName, { reason: 'control-api' });
          sendJson(res, 200, { ok: true, ...result });
          return;
        }

        sendJson(res, 404, { ok: false, error: 'Not found' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        sendJson(res, 500, { ok: false, error: message });
      }
    });

    await new Promise((resolve, reject) => {
      controlServer.listen(controlPort, controlHost, () => {
        console.log(`[agent-manager] control API listening on http://${controlHost}:${controlPort}`);
        resolve();
      });
      controlServer.on('error', reject);
    });
  }

  const defaultRoom = String(process.env.LIVEKIT_ROOM || '').trim();
  const shouldAutoJoinDefault = process.env.AGENT_AUTO_JOIN_DEFAULT_ROOM !== 'false';

  if (defaultRoom && shouldAutoJoinDefault) {
    await ensureSession(defaultRoom, {
      interactiveStdin: process.env.ENABLE_STDIN !== 'false',
      reason: 'startup-default-room',
    });
  } else if (process.env.ENABLE_STDIN !== 'false') {
    console.log('[agent-manager] stdin disabled until a room session is active');
  }

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[agent-manager] shutting down...');

    if (controlServer) {
      await new Promise((resolve) => controlServer.close(resolve));
      controlServer = null;
    }

    const pending = Array.from(pendingJoins.values());
    await Promise.allSettled(pending);

    const activeSessions = Array.from(sessions.values());
    await Promise.allSettled(activeSessions.map((session) => session.stop('process_shutdown')));

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startManager().catch((err) => {
  console.error('[agent-manager] fatal error:', err);
  process.exit(1);
});
