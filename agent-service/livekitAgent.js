require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const OpenAI = require('openai');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
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
const {
  getDefaultClassicInterviewPrompt,
  getDefaultRealtimeScreeningPrompt,
  buildEvaluationReportPrompt,
} = require('./promptTemplates');
const { createLivekitAgent } = require('./agents/livekitAgents');

const REQUIRED_ENV = ['OPENAI_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

function getNumberEnv(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min || value > max) {
    return fallback;
  }
  return value;
}

const TARGET_SAMPLE_RATE = 48000;
const TARGET_CHANNELS = 1;
const FRAME_DURATION_MS = 10;
const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
const AUDIO_PUMP_MAX_QUEUE_SECONDS = getNumberEnv('AUDIO_PUMP_MAX_QUEUE_SECONDS', 0.8, {
  min: 0.1,
  max: 5,
});
const TEXT_DECODER = new TextDecoder();
const STT_SAMPLE_RATE = 16000;
const STT_CHANNELS = 1;
const BOT_IDENTITY_BASE = (process.env.BOT_IDENTITY || 'bristlecone-ai-agent').trim();
const BOT_NAME = (process.env.BOT_NAME || 'Bristlecone AI Agent').trim();
const ROOM_IDLE_TIMEOUT_MS = Math.max(30000, Number(process.env.AGENT_ROOM_IDLE_TIMEOUT_MS || 180000));
const EMPTY_ROOM_FINALIZE_DELAY_MS = Math.max(
  3000,
  Number(process.env.EMPTY_ROOM_FINALIZE_DELAY_MS || 8000),
);
const POST_JOIN_EMPTY_ROOM_FINALIZE_DELAY_MS = Math.max(
  EMPTY_ROOM_FINALIZE_DELAY_MS,
  Number(process.env.POST_JOIN_EMPTY_ROOM_FINALIZE_DELAY_MS || 30000),
);
const RECONNECT_GRACE_MS = Math.max(
  POST_JOIN_EMPTY_ROOM_FINALIZE_DELAY_MS,
  Number(process.env.AGENT_RECONNECT_GRACE_MS || 120000),
);
const INTERVIEW_MODE = process.env.AGENT_INTERVIEW_MODE !== 'false';
const AGENT_TYPE_CLASSIC = 'classic';
const AGENT_TYPE_REALTIME_SCREENING = 'realtime_screening';
const DEFAULT_SCREENING_MAX_MINUTES = 10;
const DEFAULT_STT_VAD_RMS_THRESHOLD = 0.0035;
const DEFAULT_STT_MIN_SPEECH_MS = 350;
const DEFAULT_STT_MAX_SILENCE_MS = 900;
const DEFAULT_STT_MAX_UTTERANCE_MS = 30000;
const DEFAULT_STT_MIN_TRANSCRIBE_MS = 400;
const DEFAULT_STT_GRACE_MS = 350;

const SCREENING_MAX_MINUTES = getNumberEnv(
  'SCREENING_AGENT_MAX_MINUTES',
  DEFAULT_SCREENING_MAX_MINUTES,
  { min: 1, max: 180 },
);
const STT_VAD_RMS_THRESHOLD = getNumberEnv(
  'STT_VAD_RMS_THRESHOLD',
  DEFAULT_STT_VAD_RMS_THRESHOLD,
  { min: 0.0001, max: 0.1 },
);
const STT_MIN_SPEECH_MS = getNumberEnv('STT_MIN_SPEECH_MS', DEFAULT_STT_MIN_SPEECH_MS, {
  min: 1,
  max: 10000,
});
const STT_MAX_SILENCE_MS = getNumberEnv('STT_MAX_SILENCE_MS', DEFAULT_STT_MAX_SILENCE_MS, {
  min: 100,
  max: 20000,
});
const STT_MAX_UTTERANCE_MS = getNumberEnv(
  'STT_MAX_UTTERANCE_MS',
  DEFAULT_STT_MAX_UTTERANCE_MS,
  { min: 1000, max: 120000 },
);
const STT_MIN_TRANSCRIBE_MS = getNumberEnv(
  'STT_MIN_TRANSCRIBE_MS',
  DEFAULT_STT_MIN_TRANSCRIBE_MS,
  { min: 100, max: 10000 },
);
const STT_GRACE_MS = getNumberEnv('STT_GRACE_MS', DEFAULT_STT_GRACE_MS, {
  min: 0,
  max: 10000,
});
const BARGE_IN_MIN_WORDS = getNumberEnv('BARGE_IN_MIN_WORDS', 4, {
  min: 1,
  max: 20,
});
const BARGE_IN_MIN_CHARS = getNumberEnv('BARGE_IN_MIN_CHARS', 20, {
  min: 5,
  max: 200,
});
const ALLOW_CLASSIC_BARGE_IN_DURING_SPEAKING =
  String(process.env.ALLOW_CLASSIC_BARGE_IN_DURING_SPEAKING || '').trim().toLowerCase() === 'true';
const AGENT_PROGRESSIVE_TTS =
  String(process.env.AGENT_PROGRESSIVE_TTS || '').trim().toLowerCase() === 'true';
const BOOTSTRAP_AUDIO_PROBE =
  String(process.env.BOOTSTRAP_AUDIO_PROBE || '').trim().toLowerCase() === 'true';
const FINAL_TRANSCRIPT_MAX_CHARS = 500000;

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
    onSpeechStart,
    participantIdentity,
    rmsThreshold = STT_VAD_RMS_THRESHOLD,
    minSpeechMs = STT_MIN_SPEECH_MS,
    maxSilenceMs = STT_MAX_SILENCE_MS,
    maxUtteranceMs = STT_MAX_UTTERANCE_MS,
    minTranscribeMs = STT_MIN_TRANSCRIBE_MS,
    graceMs = STT_GRACE_MS,
  }) {
    this.transcriptionService = transcriptionService;
    this.onTranscription = onTranscription;
    this.onSpeechStart = onSpeechStart;
    this.participantIdentity = participantIdentity;

    this.rmsThreshold = rmsThreshold;
    this.minSpeechFrames = Math.max(1, Math.round(minSpeechMs / 20));
    this.maxSilenceFrames = Math.max(1, Math.round(maxSilenceMs / 20));
    this.graceFrames = Math.max(0, Math.round(graceMs / 20));
    this.maxUtteranceFrames = Math.max(1, Math.round(maxUtteranceMs / 20));
    this.minTranscribeSamples = Math.max(1, Math.floor((minTranscribeMs / 1000) * STT_SAMPLE_RATE));

    this.inSpeech = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.utteranceFrames = [];
    this.transcribing = false;
    this.speechStartNotified = false;
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
      if (!this.speechStartNotified) {
        this.speechStartNotified = true;
        if (typeof this.onSpeechStart === 'function') {
          Promise.resolve(this.onSpeechStart()).catch((err) => {
            console.warn(`[stt][${this.participantIdentity}] onSpeechStart callback error:`, err);
          });
        }
      }
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

    if (this.silenceFrames >= this.maxSilenceFrames + this.graceFrames) {
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
    this.speechStartNotified = false;
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

function normalizeAgentType(raw) {
  return String(raw || '').trim() === AGENT_TYPE_REALTIME_SCREENING
    ? AGENT_TYPE_REALTIME_SCREENING
    : AGENT_TYPE_CLASSIC;
}

function botIdentityForRoom(roomName, agentType = AGENT_TYPE_CLASSIC) {
  const suffix = normalizeRoomName(roomName).slice(0, 32) || 'room';
  const typeSuffix = agentType === AGENT_TYPE_REALTIME_SCREENING ? 'rt' : 'cl';
  return `${BOT_IDENTITY_BASE}-${typeSuffix}-${suffix}`;
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
  return '';
}

function getAppBaseUrls() {
  const explicit = getAppBaseUrl();
  const fromLivekit = toHttpUrl(process.env.LIVEKIT_URL || '');
  const fromSite = String(process.env.SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  const defaultLocal = ['http://127.0.0.1:3000', 'http://localhost:3000'];

  const all = [
    ...String(explicit || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    fromLivekit,
    fromSite.replace(/\/+$/, ''),
    ...defaultLocal,
  ].filter(Boolean);

  return Array.from(new Set(all));
}

async function evictStaleBotParticipants(roomName, keepIdentity = '') {
  const livekitHttpUrl = toHttpUrl(process.env.LIVEKIT_URL || '');
  const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
  if (!livekitHttpUrl || !apiKey || !apiSecret) return;
  if (process.env.AGENT_EVICT_STALE_BOTS === 'false') return;

  const room = String(roomName || '').trim();
  if (!room) return;
  const keep = String(keepIdentity || '').trim();

  try {
    const client = new RoomServiceClient(livekitHttpUrl, apiKey, apiSecret);
    const participants = await client.listParticipants(room);
    const botIdentities = participants
      .map((p) => String(p.identity || '').trim())
      .filter((identity) => identity && isBotIdentity(identity));

    for (const identity of botIdentities) {
      if (keep && identity === keep) continue;
      try {
        await client.removeParticipant(room, identity);
        console.log(`[agent-manager] evicted stale bot '${identity}' from '${room}'`);
      } catch (err) {
        console.warn(
          `[agent-manager] failed to evict stale bot '${identity}' from '${room}':`,
          err?.message || err,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[agent-manager] failed to list participants for stale bot cleanup in '${room}':`,
      err?.message || err,
    );
  }
}

function normalizeRecommendation(value) {
  const allowed = new Set(['strong_hire', 'hire', 'hold', 'no_hire']);
  return allowed.has(String(value || '').trim()) ? String(value).trim() : 'hold';
}

function normalizeDecision(value) {
  const allowed = new Set(['strong_hire', 'hire', 'lean_hire', 'lean_no', 'no_hire']);
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return allowed.has(normalized) ? normalized : 'lean_no';
}

function decisionToLegacyRecommendation(decision) {
  switch (normalizeDecision(decision)) {
    case 'strong_hire':
      return 'strong_hire';
    case 'hire':
    case 'lean_hire':
      return 'hire';
    case 'no_hire':
      return 'no_hire';
    case 'lean_no':
    default:
      return 'hold';
  }
}

function normalizeConfidenceLabel(value) {
  const allowed = new Set(['high', 'medium', 'low']);
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'medium';
}

function normalizeSignal(value) {
  const allowed = new Set(['strong', 'moderate', 'weak']);
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'moderate';
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function scoreToFive(score100) {
  const normalized = Number(score100) / 20;
  return Math.max(1, Math.min(5, Math.round(normalized || 0)));
}

function nowIso() {
  return new Date().toISOString();
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function normalizeSkillList(values, limit = 20) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractQuestionFromText(text) {
  const chunks = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.includes('?')) return chunk.slice(0, 280);
  }
  return '';
}

function toShortSpeechText(text, maxWords = 8) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const words = firstSentence.split(' ').filter(Boolean);
  return words.slice(0, Math.max(1, maxWords)).join(' ');
}

function includesAny(normalizedText, phrases) {
  return phrases.some((phrase) => normalizedText.includes(phrase));
}

function findMatchingSkillName(normalizedText, skills) {
  for (const raw of skills) {
    const skill = String(raw || '').trim();
    if (!skill) continue;
    if (normalizedText.includes(skill.toLowerCase())) return skill;
  }
  return '';
}

function parseVoiceControls(normalizedText) {
  return [];
}

function classifyUtterance(text, context = {}) {
  const normalized = String(text || '').toLowerCase().trim();
  const mustHaveSkills = normalizeSkillList(context.mustHaveSkills);
  const requiredTechStack = normalizeSkillList(context.requiredTechStack);
  const goodToHaveSkills = normalizeSkillList(context.goodToHaveSkills);
  const currentSkill = String(context.currentSkill || '').trim();
  const voiceControls = parseVoiceControls(normalized);
  if (voiceControls.length > 0) {
    return { classification: 'VOICE_CONTROL', driftSkill: '', voiceControls };
  }

  const explicitPivot = /\b(let'?s talk about|can we talk about|switch to|move to|focus on|ask about)\b/.test(
    normalized,
  );
  const driftSkill = findMatchingSkillName(normalized, goodToHaveSkills);
  if (explicitPivot && driftSkill) {
    return { classification: 'GOOD_TO_HAVE_DRIFT', driftSkill, voiceControls: [] };
  }

  if (
    includesAny(normalized, [
      'joke',
      'funny',
      'trivia',
      'movie',
      'sports',
      'weather',
      'news',
      'celebrity',
      'horoscope',
      'riddle',
      'game',
      'song',
      'personal advice',
    ])
  ) {
    return { classification: 'OFF_TOPIC', driftSkill: '', voiceControls: [] };
  }

  const interviewTerms = [currentSkill, ...mustHaveSkills, ...requiredTechStack]
    .map((term) => String(term || '').trim().toLowerCase())
    .filter(Boolean);
  if (interviewTerms.some((term) => normalized.includes(term))) {
    return { classification: 'INTERVIEW_RELEVANT', driftSkill: '', voiceControls: [] };
  }

  if (normalized.split(/\s+/).filter(Boolean).length <= 2) {
    return { classification: 'UNCLEAR', driftSkill: '', voiceControls: [] };
  }

  return { classification: 'INTERVIEW_RELEVANT', driftSkill: '', voiceControls: [] };
}

function buildRedirectPrefix() {
  return "I hear you. I'll keep us focused on the interview.";
}

function getAgentSettingsPath() {
  const baseDir = process.env.INTERVIEW_DATA_DIR || path.join(os.homedir(), '.bristlecone-data', 'interviews');
  return path.join(baseDir, 'agent-settings.json');
}

function readNumberSetting(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function buildDefaultPromptTemplates() {
  return {
    classicPrompt: getDefaultClassicInterviewPrompt(),
    realtimePrompt: getDefaultRealtimeScreeningPrompt(),
    screeningMaxMinutes: SCREENING_MAX_MINUTES,
    sttVadRmsThreshold: STT_VAD_RMS_THRESHOLD,
    sttMinSpeechMs: STT_MIN_SPEECH_MS,
    sttMaxSilenceMs: STT_MAX_SILENCE_MS,
    sttMaxUtteranceMs: STT_MAX_UTTERANCE_MS,
    sttMinTranscribeMs: STT_MIN_TRANSCRIBE_MS,
    sttGraceMs: STT_GRACE_MS,
  };
}

function normalizePromptTemplates(raw) {
  const defaults = buildDefaultPromptTemplates();
  const parsed = raw || {};
  return {
    classicPrompt: firstNonEmptyText(parsed?.classicPrompt) || defaults.classicPrompt,
    realtimePrompt: firstNonEmptyText(parsed?.realtimePrompt) || defaults.realtimePrompt,
    screeningMaxMinutes: readNumberSetting(parsed?.screeningMaxMinutes, defaults.screeningMaxMinutes, 1, 180),
    sttVadRmsThreshold: readNumberSetting(parsed?.sttVadRmsThreshold, defaults.sttVadRmsThreshold, 0.0001, 0.1),
    sttMinSpeechMs: readNumberSetting(parsed?.sttMinSpeechMs, defaults.sttMinSpeechMs, 1, 10000),
    sttMaxSilenceMs: readNumberSetting(parsed?.sttMaxSilenceMs, defaults.sttMaxSilenceMs, 100, 20000),
    sttMaxUtteranceMs: readNumberSetting(parsed?.sttMaxUtteranceMs, defaults.sttMaxUtteranceMs, 1000, 120000),
    sttMinTranscribeMs: readNumberSetting(parsed?.sttMinTranscribeMs, defaults.sttMinTranscribeMs, 100, 10000),
    sttGraceMs: readNumberSetting(parsed?.sttGraceMs, defaults.sttGraceMs, 0, 10000),
  };
}

async function loadPromptTemplatesFromAppApi() {
  const appBaseUrls = getAppBaseUrls();
  if (appBaseUrls.length === 0) return null;

  for (const base of appBaseUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${base}/api/agent-settings`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const json = await response.json().catch(() => ({}));
      const settings = json?.settings || {};
      const normalized = normalizePromptTemplates(settings);
      console.log(`[agent-settings] loaded prompt templates from app API: ${base}`);
      return normalized;
    } catch {
      // Try next base URL.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function loadPersistedPromptTemplates() {
  const fromApi = await loadPromptTemplatesFromAppApi();
  if (fromApi) return fromApi;

  try {
    const raw = await fs.readFile(getAgentSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizePromptTemplates(parsed);
    console.log('[agent-settings] loaded prompt templates from local agent-settings.json');
    return normalized;
  } catch {
    console.log('[agent-settings] using built-in defaults (API/local settings unavailable)');
    return buildDefaultPromptTemplates();
  }
}

function buildInterviewRuntimeInstruction({ candidateContext = '', roleContext = '', basePrompt = '' } = {}) {
  const contextLines = [];
  if (candidateContext) contextLines.push(`Candidate context: ${candidateContext}`);
  if (roleContext) contextLines.push(`Role context: ${roleContext}`);
  const contextBlock = contextLines.length ? `\n\nKnown context:\n${contextLines.join('\n')}` : '';

  const prompt = firstNonEmptyText(basePrompt) || getDefaultClassicInterviewPrompt();
  return `${prompt}${contextBlock}`;
}

function buildRealtimeScreeningRuntimeInstruction({
  candidateContext = '',
  roleContext = '',
  basePrompt = '',
  jobMetadata = {},
  interviewState = {},
  voiceStyleInstruction = '',
} = {}) {
  const contextLines = [];
  if (candidateContext) contextLines.push(`Candidate context: ${candidateContext}`);
  if (roleContext) contextLines.push(`Role context: ${roleContext}`);
  const mustHaveSkills = normalizeSkillList(jobMetadata.mustHaveSkills);
  const requiredTechStack = normalizeSkillList(jobMetadata.requiredTechStack);
  const goodToHaveSkills = normalizeSkillList(jobMetadata.goodToHaveSkills);
  const currentSkill = String(interviewState.currentSkill || '').trim();
  const currentQuestion = String(interviewState.currentQuestion || '').trim();
  const currentTopic = String(interviewState.currentTopic || '').trim();
  contextLines.push('Interview guardrails: stay strictly in interview mode.');
  contextLines.push(
    'Allowed only: interview Q&A and follow-ups tied to the current question.',
  );
  contextLines.push(
    'Disallowed: jokes, entertainment, trivia/general knowledge, personal advice, unrelated chat. Refuse and redirect.',
  );
  contextLines.push(
    'Must-have focus: keep majority probing on must-have skills; use required tech stack to validate must-have depth; defer good-to-have topics.',
  );
  contextLines.push(
    `Current anchor: skill="${currentSkill || 'unassigned'}", topic="${currentTopic || currentSkill || 'unassigned'}", question="${currentQuestion || 'unassigned'}".`,
  );
  contextLines.push(`Must-have skills: ${mustHaveSkills.join(', ') || 'not provided'}`);
  contextLines.push(`Required tech stack: ${requiredTechStack.join(', ') || 'not provided'}`);
  contextLines.push(`Good-to-have skills (defer): ${goodToHaveSkills.join(', ') || 'not provided'}`);
  const contextBlock = contextLines.length ? `\n\nKnown context:\n${contextLines.join('\n')}` : '';

  const prompt = firstNonEmptyText(basePrompt) || getDefaultRealtimeScreeningPrompt();
  return `${prompt}${contextBlock}`;
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

async function createAgentSession(
  roomName,
  { interactiveStdin = false, onStop, agentType = AGENT_TYPE_CLASSIC } = {},
) {
  const selectedAgentType = normalizeAgentType(agentType);
  const livekitUrl = normalizeLiveKitUrl(process.env.LIVEKIT_URL);
  const persistedPromptTemplates = await loadPersistedPromptTemplates();
  const sttTurnConfig = {
    rmsThreshold: persistedPromptTemplates.sttVadRmsThreshold,
    minSpeechMs: persistedPromptTemplates.sttMinSpeechMs,
    maxSilenceMs: persistedPromptTemplates.sttMaxSilenceMs,
    maxUtteranceMs: persistedPromptTemplates.sttMaxUtteranceMs,
    minTranscribeMs: persistedPromptTemplates.sttMinTranscribeMs,
    graceMs: persistedPromptTemplates.sttGraceMs,
  };
  if (selectedAgentType === AGENT_TYPE_REALTIME_SCREENING) {
    sttTurnConfig.rmsThreshold = Math.min(sttTurnConfig.rmsThreshold, 0.004);
    sttTurnConfig.maxSilenceMs = Math.min(sttTurnConfig.maxSilenceMs, 900);
    sttTurnConfig.minTranscribeMs = Math.min(sttTurnConfig.minTranscribeMs, 400);
  }
  const agent = createLivekitAgent({
    roomName,
    agentType: selectedAgentType,
    persistedPromptTemplates,
    deps: {
      AGENT_TYPE_CLASSIC,
      AGENT_TYPE_REALTIME_SCREENING,
      BOT_NAME,
      INTERVIEW_MODE,
      SCREENING_MAX_MINUTES: persistedPromptTemplates.screeningMaxMinutes,
      normalizeAgentType,
      botIdentityForRoom,
      isBotIdentity,
      firstNonEmptyText,
      buildInterviewRuntimeInstruction,
      buildRealtimeScreeningRuntimeInstruction,
    },
  });
  const identity = agent.identity;
  const selectedBotName = agent.botName;
  const token = await createJoinToken({ roomName, identity, name: selectedBotName });

  const room = new Room();
  let stopping = false;
  let stopped = false;
  let idleTimer = null;
  let emptyRoomStopTimer = null;
  let interviewStarted = false;
  let candidateEverJoined = false;
  let interviewStartedAt = '';
  let finalReportPublished = false;
  let interviewId = '';
  let isInterviewPaused = false;
  const transcript = [];

  const state = {
    kickoffSent: false,
    candidateEverJoined: false,
    screeningHardStopTimer: null,
  };
  const hasHumanParticipants = () => {
    for (const participant of room.remoteParticipants.values()) {
      if (!isBotIdentity(participant.identity)) return true;
    }
    return false;
  };

  const handleParticipantConnected = (participant, source = 'event') => {
    console.log(`[room:${roomName}] participant connected: ${participant.identity}`);
    if (source !== 'event') {
      console.log(`[room:${roomName}] participant detected on connect: ${participant.identity}`);
    }
    if (!isBotIdentity(participant.identity)) {
      candidateEverJoined = true;
      state.candidateEverJoined = true;
    }
    if (selectedAgentType === AGENT_TYPE_CLASSIC && isInterviewPaused) {
      console.log(`[agent][${roomName}] clearing stale paused state on reconnect`);
      isInterviewPaused = false;
    }
    void publishPauseState();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (emptyRoomStopTimer) {
      clearTimeout(emptyRoomStopTimer);
      emptyRoomStopTimer = null;
    }
    if (state.screeningHardStopTimer) {
      clearTimeout(state.screeningHardStopTimer);
      state.screeningHardStopTimer = null;
    }
    agent.onParticipantConnected({
      participant,
      state,
      queueUserTurn,
      ensureInterviewStarted,
      stop,
    });
    candidateEverJoined = state.candidateEverJoined;
  };

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    handleParticipantConnected(participant, 'event');
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.log(`[room:${roomName}] participant disconnected: ${participant.identity}`);
    void publishPauseState();
    if (!hasHumanParticipants()) {
      state.kickoffSent = false;
      kickoffTurnCompleted = false;
      console.log(`[agent][${roomName}] reset kickoff state after all human participants left`);
    }
    if (emptyRoomStopTimer) {
      clearTimeout(emptyRoomStopTimer);
      emptyRoomStopTimer = null;
    }
    if (room.remoteParticipants.size === 0) {
      const emptyDelayMs = candidateEverJoined
        ? RECONNECT_GRACE_MS
        : EMPTY_ROOM_FINALIZE_DELAY_MS;
      emptyRoomStopTimer = setTimeout(() => {
        stop('room_empty').catch((err) => {
          console.error(`[agent][${roomName}] empty room stop failed:`, err);
        });
      }, emptyDelayMs);
    }
    scheduleIdleStop();
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log(`[room:${roomName}] disconnected`);
    if (!stopping && !stopped) {
      stop('room_disconnected').catch((err) => {
        console.error(`[agent][${roomName}] room_disconnected stop failed:`, err);
      });
    }
  });

  let audioPump = null;
  let controlStateInterval = null;

  const llmService = new LLMService({
    apiKey: process.env.OPENAI_API_KEY,
    model: agent.getLlmModel(),
    fallbackModel: agent.getLlmFallbackModel(),
    systemPrompt: process.env.OPENAI_SYSTEM_PROMPT || undefined,
  });

  const classicVoice = process.env.OPENAI_TTS_VOICE_CLASSIC || 'ash';
  const realtimeVoice =
    process.env.OPENAI_TTS_VOICE_REALTIME_SCREENING || process.env.OPENAI_TTS_VOICE || 'coral';
  const ttsVoice = selectedAgentType === AGENT_TYPE_REALTIME_SCREENING ? realtimeVoice : classicVoice;

  const ttsService = new TTSService({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: ttsVoice,
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
  const jobMetadata = {
    mustHaveSkills: [],
    requiredTechStack: [],
    goodToHaveSkills: [],
  };
  const interviewState = {
    currentQuestion: '',
    currentSkill: '',
    currentTopic: '',
  };
  let voiceStyleInstruction = '';
  const fallbackRuntimeInstruction = firstNonEmptyText(
    process.env.OPENAI_RUNTIME_INSTRUCTION,
    'Have a natural spoken conversation. Keep responses brief, clear, and friendly.',
  );

  const activeInputStreams = new Map();
  let assistantState = 'idle'; // idle | thinking | speaking
  let interruptRequested = false;
  let kickoffTurnCompleted = false;
  let awaitingKickoffAck = false;
  let kickoffRecoveryRequested = false;
  let latestInputSeq = 0;
  let processingInputQueue = false;
  let queueWorker = Promise.resolve();
  const inputQueue = [];
  const isRealtimeScreeningAgent = selectedAgentType === AGENT_TYPE_REALTIME_SCREENING;
  const appBaseUrls = getAppBaseUrls();
  let lastGoodAppBaseUrl = appBaseUrls[0] || '';
  const apiRequestTimeoutMs = Math.max(1200, Number(process.env.AGENT_API_TIMEOUT_MS || 3500));
  const apiRetryCount = Math.max(1, Number(process.env.AGENT_API_RETRY_COUNT || 2));

  const requestInterruption = () => {
    if (assistantState === 'idle') return;
    interruptRequested = true;
    if (audioPump) audioPump.clear();
  };

  const fetchAppApi = async (pathName, options = {}) => {
    const bases = [lastGoodAppBaseUrl, ...appBaseUrls].filter(Boolean);
    let lastErr = null;

    for (const base of Array.from(new Set(bases))) {
      for (let i = 0; i < apiRetryCount; i += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), apiRequestTimeoutMs + i * 800);
        try {
          const res = await fetch(`${base}${pathName}`, {
            ...options,
            signal: controller.signal,
          });
          if (res.ok) {
            lastGoodAppBaseUrl = base;
            return res;
          }
          lastErr = new Error(`${options.method || 'GET'} ${pathName} failed via ${base} (${res.status})`);
        } catch (err) {
          lastErr = err;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw lastErr || new Error(`API request failed for ${pathName}`);
  };

  const appendTranscript = (entry) => {
    transcript.push(entry);
    if (transcript.length > 220) transcript.splice(0, transcript.length - 220);
  };

  const updateJobMetadata = ({ mustHaveSkills, requiredTechStack, goodToHaveSkills } = {}) => {
    if (Array.isArray(mustHaveSkills)) {
      jobMetadata.mustHaveSkills = normalizeSkillList(mustHaveSkills);
    }
    if (Array.isArray(requiredTechStack)) {
      jobMetadata.requiredTechStack = normalizeSkillList(requiredTechStack);
    }
    if (Array.isArray(goodToHaveSkills)) {
      jobMetadata.goodToHaveSkills = normalizeSkillList(goodToHaveSkills);
    }
    if (!interviewState.currentSkill && jobMetadata.mustHaveSkills.length > 0) {
      interviewState.currentSkill = String(jobMetadata.mustHaveSkills[0] || '');
      interviewState.currentTopic = interviewState.currentSkill;
    }
  };

  const updateInterviewState = ({ currentQuestion, currentSkill, currentTopic } = {}) => {
    const question = String(currentQuestion || '').trim();
    const skill = String(currentSkill || '').trim();
    const topic = String(currentTopic || '').trim();
    if (question) interviewState.currentQuestion = question.slice(0, 280);
    if (skill) interviewState.currentSkill = skill.slice(0, 120);
    if (topic) interviewState.currentTopic = topic.slice(0, 120);
  };

  // Keeps current skill/topic context aligned for classic turn-based prompting.
  const setCurrentSkill = (skillName, currentQuestion, topicLabel = '') => {
    const nextSkill = String(skillName || '').trim() || interviewState.currentSkill || jobMetadata.mustHaveSkills[0] || '';
    const nextQuestion = String(currentQuestion || '').trim() || interviewState.currentQuestion;
    const nextTopic = String(topicLabel || '').trim() || nextSkill;
    if (!nextSkill) return;
    interviewState.currentSkill = nextSkill;
    interviewState.currentTopic = nextTopic;
    if (nextQuestion) {
      interviewState.currentQuestion = nextQuestion.slice(0, 280);
    }
  };

  const applyVoiceControls = (controls = []) => {
    const deduped = Array.from(new Set(controls));
    if (deduped.length === 0) return;
    voiceStyleInstruction = deduped.join(', ');
  };

  const buildRedirectTail = () =>
    interviewState.currentQuestion
      ? `Continuing: ${interviewState.currentQuestion}`
      : `Let's go back to ${interviewState.currentSkill || 'the current must-have skill'}.`;

  const buildTurnGuard = (text) => {
    const result = classifyUtterance(text, {
      mustHaveSkills: jobMetadata.mustHaveSkills,
      requiredTechStack: jobMetadata.requiredTechStack,
      goodToHaveSkills: jobMetadata.goodToHaveSkills,
      currentSkill: interviewState.currentSkill,
    });

    if (result.classification === 'VOICE_CONTROL') {
      applyVoiceControls(result.voiceControls);
      return {
        ...result,
        shouldRedirect: true,
        systemMessage: `Interview mode. Requested voice controls: ${result.voiceControls.join(', ')}. Respond in 1-2 sentences: "${buildRedirectPrefix()} ${buildRedirectTail()}" Then continue on ${interviewState.currentSkill || 'the active must-have skill'}.`,
      };
    }
    if (result.classification === 'OFF_TOPIC') {
      return {
        ...result,
        shouldRedirect: true,
        systemMessage: `Interview mode. Do not answer off-topic request. Respond in 1-2 sentences: "${buildRedirectPrefix()} ${buildRedirectTail()}"`,
      };
    }
    if (result.classification === 'GOOD_TO_HAVE_DRIFT') {
      return {
        ...result,
        shouldRedirect: true,
        systemMessage: `Candidate is drifting to good-to-have topic: ${result.driftSkill || 'unknown'}. Redirect back to must-have skill: ${interviewState.currentSkill || jobMetadata.mustHaveSkills[0] || 'current must-have'}. Ask a focused follow-up on ${interviewState.currentSkill || jobMetadata.mustHaveSkills[0] || 'the current skill'}.`,
      };
    }
    if (result.classification === 'UNCLEAR') {
      return {
        ...result,
        shouldRedirect: false,
        systemMessage: `Interview mode. Candidate response is unclear. Ask one brief clarifying question tied to ${interviewState.currentSkill || 'the active must-have skill'}.`,
      };
    }
    return {
      ...result,
      shouldRedirect: false,
      systemMessage: '',
    };
  };

  const getRuntimeInstruction = () =>
    INTERVIEW_MODE
      ? agent.buildRuntimeInstruction({
          candidateContext,
          roleContext,
          jobMetadata,
          interviewState,
          voiceStyleInstruction,
        })
      : fallbackRuntimeInstruction;

  const buildTranscriptText = () =>
    transcript
      .map((entry) => {
        const ts = entry?.ts ? new Date(entry.ts).toISOString() : nowIso();
        const speaker = entry?.role === 'assistant' ? 'Interviewer Bot' : entry?.by || 'Candidate';
        const text = String(entry?.text || '').replace(/\s+/g, ' ').trim();
        return text ? `[${ts}] ${speaker}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 60000);

  const countCandidateTurnsInTranscriptText = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return 0;
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && /\]\s*Candidate\s*:/.test(line)).length;
  };

  const mergeTranscriptText = (existingText, generatedText) => {
    const existing = String(existingText || '').trim();
    const generated = String(generatedText || '').trim();
    if (existing && generated) {
      if (existing.includes(generated)) return existing.slice(-FINAL_TRANSCRIPT_MAX_CHARS);
      if (generated.includes(existing)) return generated.slice(-FINAL_TRANSCRIPT_MAX_CHARS);
      return `${existing}\n${generated}`.slice(-FINAL_TRANSCRIPT_MAX_CHARS);
    }
    return (generated || existing).slice(-FINAL_TRANSCRIPT_MAX_CHARS);
  };

  const waitForPersistedTranscript = async (initialLatest) => {
    let latest = initialLatest || null;
    let transcriptText = String(latest?.transcriptText || '').trim();
    if (selectedAgentType !== AGENT_TYPE_REALTIME_SCREENING) {
      return { latest, transcriptText };
    }

    const deadline = Date.now() + 12000;
    let stableRounds = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      let next = null;
      try {
        next = await fetchLatestInterviewByRoom();
      } catch {
        next = null;
      }
      if (next?.id && !interviewId) {
        interviewId = next.id;
      }
      const nextText = String(next?.transcriptText || '').trim();
      if (nextText.length > transcriptText.length) {
        transcriptText = nextText;
        latest = next;
        stableRounds = 0;
      } else if (countCandidateTurnsInTranscriptText(transcriptText) > 0) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
      }
    }
    return { latest, transcriptText };
  };

  const fetchLatestInterviewByRoom = async () => {
    if (appBaseUrls.length === 0) return null;
    const res = await fetchAppApi('/api/interviews', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
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
    if (!id) return null;
    const res = await fetchAppApi(`/api/interviews/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
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
      updateJobMetadata({
        mustHaveSkills: latest?.positionSnapshot?.must_haves || [],
        requiredTechStack: latest?.positionSnapshot?.tech_stack || [],
        goodToHaveSkills: latest?.positionSnapshot?.nice_to_haves || [],
      });
      if (interviewState.currentSkill) {
        setCurrentSkill(interviewState.currentSkill, interviewState.currentQuestion, interviewState.currentTopic);
      }
      await patchInterview(interviewId, {
        meetingActualStart: interviewStartedAt,
      });
    } catch (err) {
      console.warn(`[agent][${roomName}] failed to mark interview start:`, err?.message || err);
    }
  };

  const buildFallbackAssessment = (stopReason, turnCountOverride = null) => {
    const observedTurnCount = transcript.filter((t) => t.role === 'candidate').length;
    const turnCount = Number.isFinite(turnCountOverride) ? Math.max(0, Number(turnCountOverride)) : observedTurnCount;
    const interviewScore = turnCount >= 8 ? 68 : turnCount >= 4 ? 58 : 48;
    const rubricScore = turnCount >= 8 ? 6.8 : turnCount >= 4 ? 5.8 : 4.8;
    const competencyTemplate = [
      'Problem Solving & Reasoning',
      'Technical Depth (role-specific)',
      'Solution Design / Architecture',
      'Communication & Clarity',
      'Quality & Reliability',
    ].map((name) => ({
      name,
      score: scoreToFive(interviewScore),
      evidence: 'Evidence: Not available (no transcript).',
      strengths: ['Interview was completed with enough interaction to infer baseline signal.'],
      concerns: ['Competency evidence is limited; requires targeted follow-up validation.'],
    }));
    return {
      summaryFeedback: `Interview ended (${stopReason}) after ${turnCount} candidate turns. Report generated from available conversation.`,
      detailedFeedback:
        'Strengths: communication observed in conversation. Risks: limited structured evidence due to partial/non-deterministic interview flow.',
      recommendation: 'hold',
      interviewScore,
      rubricScore,
      nextSteps: 'Schedule targeted follow-up focusing on depth, architecture tradeoffs, and measurable impact examples.',
      report: {
        executiveSummary:
          'Candidate provided partial evidence across technical areas, but available signals are insufficient for a high-confidence decision without targeted follow-up.',
        overallSignal: turnCount >= 8 ? 'moderate' : 'weak',
        recommendationDecision: turnCount >= 8 ? 'lean_hire' : 'lean_no',
        confidence: 'low',
        rationale: [
          'Interview completed with limited structured evidence.',
          'Depth of production troubleshooting and architecture tradeoffs remains unclear.',
          'Decision should be confirmed with a focused technical follow-up.',
        ],
        interviewScore,
        rubricScore,
        scoreImplication:
          'Score suggests partial alignment with role expectations, but not enough depth for a high-confidence hire decision.',
        calibrationNote: 'relative to expected level for Role (level unspecified).',
        competencies: competencyTemplate,
        strengths: [
          'Maintained conversation and provided role-relevant responses.',
          'Showed baseline communication and technical familiarity.',
        ],
        risks: [
          'Troubleshooting depth unclear.',
          'Production reliability and edge-case handling not fully evidenced.',
        ],
        followUpQuestions: [
          'Describe a production issue you debugged end-to-end and how you isolated root cause.',
          'Explain one architecture tradeoff you made and why.',
          'How do you validate reliability before deployment?',
        ],
        nextSteps: [
          'Run a focused technical follow-up round on debugging depth and architecture decisions.',
          'Add a practical exercise aligned to the role.',
        ],
        evidenceLimitations: 'Transcript evidence was limited or unavailable.',
      },
    };
  };

  const evaluateInterview = async (stopReason, persistedTranscriptText = '') => {
    const candidateTurns = transcript
      .filter((t) => t.role === 'candidate')
      .slice(-40)
      .map((t) => ({ ts: t.ts, by: t.by, text: t.text }));
    const assistantTurns = transcript
      .filter((t) => t.role === 'assistant')
      .slice(-40)
      .map((t) => ({ ts: t.ts, text: t.text }));
    const persistedCandidateTurns = countCandidateTurnsInTranscriptText(persistedTranscriptText);
    const observedCandidateTurns = Math.max(candidateTurns.length, persistedCandidateTurns);

    if (candidateTurns.length === 0) {
      return buildFallbackAssessment(stopReason, observedCandidateTurns);
    }

    const prompt = buildEvaluationReportPrompt({
      stopReason,
      candidateTurns,
      assistantTurns,
    });

    try {
      const raw = await llmService.callJson(prompt, {
        model: process.env.OPENAI_EVAL_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
      });
      const fallback = buildFallbackAssessment(stopReason, observedCandidateTurns);
      const reportRaw = raw?.report || {};
      const decision = normalizeDecision(reportRaw?.recommendationDecision);
      const rawRecommendation = String(raw?.recommendation || '').trim();
      const allowedLegacy = new Set(['strong_hire', 'hire', 'hold', 'no_hire']);
      const legacyRecommendation = allowedLegacy.has(rawRecommendation)
        ? rawRecommendation
        : decisionToLegacyRecommendation(decision);
      const interviewScore = Math.max(0, Math.min(100, Number(raw?.interviewScore || fallback.interviewScore) || 0));
      const rubricScore = Math.max(0, Math.min(10, Number(raw?.rubricScore || fallback.rubricScore) || 0));
      const competencies = Array.isArray(reportRaw?.competencies)
        ? reportRaw.competencies
            .map((item) => ({
              name: String(item?.name || '').trim(),
              score: clampInt(item?.score, 1, 5),
              evidence: String(item?.evidence || '').trim() || 'Evidence: Not available (no transcript).',
              strengths: Array.isArray(item?.strengths)
                ? item.strengths.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
                : [],
              concerns: Array.isArray(item?.concerns)
                ? item.concerns.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
                : [],
            }))
            .filter((item) => item.name)
            .slice(0, 7)
        : fallback.report.competencies;

      return {
        summaryFeedback: String(raw?.summaryFeedback || '').slice(0, 260) || fallback.summaryFeedback,
        detailedFeedback: String(raw?.detailedFeedback || '').slice(0, 2000) || fallback.detailedFeedback,
        recommendation: legacyRecommendation,
        interviewScore,
        rubricScore,
        nextSteps: String(raw?.nextSteps || '').slice(0, 500) || fallback.nextSteps,
        report: {
          executiveSummary:
            String(reportRaw?.executiveSummary || '').slice(0, 500) || fallback.report.executiveSummary,
          overallSignal: normalizeSignal(reportRaw?.overallSignal || fallback.report.overallSignal),
          recommendationDecision: decision,
          confidence: normalizeConfidenceLabel(reportRaw?.confidence || fallback.report.confidence),
          rationale: Array.isArray(reportRaw?.rationale)
            ? reportRaw.rationale.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
            : fallback.report.rationale,
          interviewScore,
          rubricScore,
          scoreImplication:
            String(reportRaw?.scoreImplication || '').slice(0, 300) || fallback.report.scoreImplication,
          calibrationNote:
            String(reportRaw?.calibrationNote || '').slice(0, 200) || fallback.report.calibrationNote,
          competencies: competencies.length > 0 ? competencies : fallback.report.competencies,
          strengths: Array.isArray(reportRaw?.strengths)
            ? reportRaw.strengths.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
            : fallback.report.strengths,
          risks: Array.isArray(reportRaw?.risks)
            ? reportRaw.risks.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
            : fallback.report.risks,
          followUpQuestions: Array.isArray(reportRaw?.followUpQuestions)
            ? reportRaw.followUpQuestions.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
            : fallback.report.followUpQuestions,
          nextSteps: Array.isArray(reportRaw?.nextSteps)
            ? reportRaw.nextSteps.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
            : fallback.report.nextSteps,
          evidenceLimitations:
            String(reportRaw?.evidenceLimitations || '').slice(0, 300) || fallback.report.evidenceLimitations,
        },
      };
    } catch (err) {
      console.warn(`[agent][${roomName}] evaluation generation failed:`, err?.message || err);
      return buildFallbackAssessment(stopReason, observedCandidateTurns);
    }
  };

  const publishFinalReport = async (stopReason) => {
    // Publish for any shutdown path once the interview truly started.
    if (finalReportPublished || !candidateEverJoined) return;
    if (!interviewStarted) {
      await ensureInterviewStarted().catch(() => undefined);
    }
    if (!interviewStarted) return;
    finalReportPublished = true;
    let latest = null;
    try {
      latest = await fetchLatestInterviewByRoom();
    } catch {
      latest = null;
    }
    if (!interviewId) {
      interviewId = latest?.id || '';
    }
    const persisted = await waitForPersistedTranscript(latest);
    const existingTranscriptText = String(persisted.transcriptText || '').trim();
    const assessment = await evaluateInterview(stopReason, existingTranscriptText);
    const mergedTranscriptText = mergeTranscriptText(existingTranscriptText, buildTranscriptText());
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
      assessmentReport: assessment.report,
      transcriptText: mergedTranscriptText,
    };

    try {
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
      if (!raw) {
        return {
          text: null,
          contextUpdated: false,
          metadataUpdated: false,
          interviewStateUpdated: false,
        };
      }

      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        let contextUpdated = false;
        let metadataUpdated = false;
        let interviewStateUpdated = false;
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
        const maybeMustHaveSkills =
          parsed?.mustHaveSkills ??
          parsed?.must_have_skills ??
          ctx?.mustHaveSkills ??
          ctx?.must_have_skills;
        const maybeRequiredTechStack =
          parsed?.requiredTechStack ??
          parsed?.required_tech_stack ??
          ctx?.requiredTechStack ??
          ctx?.required_tech_stack;
        const maybeGoodToHaveSkills =
          parsed?.goodToHaveSkills ??
          parsed?.good_to_have_skills ??
          ctx?.goodToHaveSkills ??
          ctx?.good_to_have_skills;
        if (Array.isArray(maybeMustHaveSkills) || Array.isArray(maybeRequiredTechStack) || Array.isArray(maybeGoodToHaveSkills)) {
          updateJobMetadata({
            mustHaveSkills: Array.isArray(maybeMustHaveSkills) ? maybeMustHaveSkills : undefined,
            requiredTechStack: Array.isArray(maybeRequiredTechStack) ? maybeRequiredTechStack : undefined,
            goodToHaveSkills: Array.isArray(maybeGoodToHaveSkills) ? maybeGoodToHaveSkills : undefined,
          });
          metadataUpdated = true;
        }
        const nextCurrentQuestion =
          parsed?.currentQuestion ?? parsed?.current_question ?? ctx?.currentQuestion ?? ctx?.current_question;
        const nextCurrentSkill =
          parsed?.currentSkill ?? parsed?.current_skill ?? ctx?.currentSkill ?? ctx?.current_skill;
        const nextCurrentTopic =
          parsed?.currentTopic ?? parsed?.current_topic ?? ctx?.currentTopic ?? ctx?.current_topic;
        if (nextCurrentQuestion || nextCurrentSkill || nextCurrentTopic) {
          updateInterviewState({
            currentQuestion: nextCurrentQuestion,
            currentSkill: nextCurrentSkill,
            currentTopic: nextCurrentTopic,
          });
          interviewStateUpdated = true;
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
          metadataUpdated,
          interviewStateUpdated,
        };
      }

      return { text: raw, contextUpdated: false, metadataUpdated: false, interviewStateUpdated: false };
    } catch {
      return { text: null, contextUpdated: false, metadataUpdated: false, interviewStateUpdated: false };
    }
  };

  const isModeratorParticipant = (participant) => {
    try {
      const meta = String(participant?.metadata || '').trim();
      if (!meta) return false;
      const parsed = JSON.parse(meta);
      return String(parsed?.role || '').trim().toLowerCase() === 'moderator';
    } catch {
      return false;
    }
  };

  const publishPauseState = async () => {
    const mediaModeEffective = isRealtimeScreeningAgent ? 'direct' : 'turn_based';
    const transportMode = isRealtimeScreeningAgent ? 'direct_client' : 'turn_based';
    try {
      const payload = Buffer.from(
        JSON.stringify({
          type: 'agent_control_state',
          paused: isInterviewPaused,
          agentType: selectedAgentType,
          transportMode,
          fullDuplex: transportMode === 'direct_client',
          realtimeReady: false,
          assistantState: String(assistantState || 'idle'),
          mediaModeConfigured: isRealtimeScreeningAgent ? 'direct' : 'turn_based',
          mediaModeEffective,
          ts: nowIso(),
        }),
      );
      await room.localParticipant.publishData(payload, { reliable: true });
    } catch (err) {
      console.warn(`[agent][${roomName}] failed to publish pause state:`, err?.message || err);
    }
  };

  const processUserInput = async (text, sourceIdentity = 'participant', seq = 0) => {
    if (isRealtimeScreeningAgent) {
      console.log(`[agent][${roomName}] realtime_screening passive mode ignoring turn from '${sourceIdentity}'`);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isInterviewPaused && sourceIdentity !== 'agent_bootstrap') {
      console.log(`[agent][${roomName}] dropping turn while paused from '${sourceIdentity}'`);
      return;
    }
    const isBootstrap = sourceIdentity === 'agent_bootstrap';

    if (isBootstrap && !interviewState.currentSkill && jobMetadata.mustHaveSkills.length > 0) {
      setCurrentSkill(
        jobMetadata.mustHaveSkills[0],
        interviewState.currentQuestion || `Let's begin with ${jobMetadata.mustHaveSkills[0]}.`,
        jobMetadata.mustHaveSkills[0],
      );
    }

    if (isBootstrap) {
      // Keep kickoff deterministic and very short to reduce first-turn latency/failures.
      assistantState = 'speaking';
      interruptRequested = false;
      process.stdout.write(`[assistant][${roomName}] `);
      const kickoffLine = 'Hi.';
      // Allow immediate candidate replies even if they start while kickoff audio is still playing.
      kickoffTurnCompleted = true;
      awaitingKickoffAck = true;
      process.stdout.write(`${kickoffLine}\n`);
      try {
        while (!audioPump) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        for await (const pcmChunk of ttsService.streamPcm48kForText(kickoffLine)) {
          await audioPump.writePcm16le(pcmChunk);
        }
        if (BOOTSTRAP_AUDIO_PROBE) {
          const probeLine = 'Audio check.';
          process.stdout.write(`[assistant][${roomName}] ${probeLine}\n`);
          for await (const pcmChunk of ttsService.streamPcm48kForText(probeLine)) {
            await audioPump.writePcm16le(pcmChunk);
          }
          if (!isInterviewPaused) {
            appendTranscript({ role: 'assistant', by: selectedBotName, text: probeLine, ts: nowIso() });
          }
        }
      } catch (error) {
        console.error(`[agent][${roomName}] kickoff TTS failed:`, error?.message || error);
      } finally {
        if (!isInterviewPaused) {
          appendTranscript({ role: 'assistant', by: selectedBotName, text: kickoffLine, ts: nowIso() });
        }
        kickoffRecoveryRequested = false;
        assistantState = 'idle';
      }
      return;
    }

    const userMessage = trimmed;
    const runtimeInstruction = getRuntimeInstruction();
    const turnGuard = isBootstrap ? null : buildTurnGuard(trimmed);

    if (!isBootstrap && !isInterviewPaused) {
      console.log(`\n[user][${roomName}] ${trimmed}`);
      appendTranscript({ role: 'candidate', by: sourceIdentity, text: trimmed, ts: nowIso() });
    }

    if (!isBootstrap && awaitingKickoffAck) {
      awaitingKickoffAck = false;
      const firstQuestion = 'Great. Recent role and key project?';
      assistantState = 'speaking';
      interruptRequested = false;
      process.stdout.write(`[assistant][${roomName}] ${firstQuestion}\n`);
      try {
        while (!audioPump) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        for await (const pcmChunk of ttsService.streamPcm48kForText(firstQuestion)) {
          await audioPump.writePcm16le(pcmChunk);
        }
      } catch (error) {
        console.error(`[agent][${roomName}] first-question TTS failed:`, error?.message || error);
      } finally {
        if (!isInterviewPaused) {
          appendTranscript({ role: 'assistant', by: selectedBotName, text: firstQuestion, ts: nowIso() });
        }
        assistantState = 'idle';
      }
      return;
    }

    assistantState = 'thinking';
    interruptRequested = false;
    process.stdout.write(`[assistant][${roomName}] `);

    if (!isBootstrap && seq > 0 && seq < latestInputSeq) {
      assistantState = 'idle';
      return;
    }

    let assistantText = '';
    try {
      const safeUserMessage = turnGuard?.shouldRedirect ? buildRedirectTail() : userMessage;
      const llmDeltaStream = llmService.streamAssistantReply(safeUserMessage, { runtimeInstruction });
      const consumeAssistantText = async () => {
        for await (const delta of llmDeltaStream) {
          if (interruptRequested || (!isBootstrap && seq > 0 && seq < latestInputSeq)) break;
          assistantText += delta;
          process.stdout.write(delta);
        }
        process.stdout.write('\n');
      };

      assistantState = 'speaking';
      while (!audioPump) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (AGENT_PROGRESSIVE_TTS) {
        const guardedLlmDeltaStream = (async function* guarded() {
          for await (const delta of llmDeltaStream) {
            if (interruptRequested || (!isBootstrap && seq > 0 && seq < latestInputSeq)) break;
            assistantText += delta;
            process.stdout.write(delta);
            yield delta;
          }
          process.stdout.write('\n');
        })();
        for await (const pcmChunk of ttsService.streamFromLlmText(guardedLlmDeltaStream)) {
          if (interruptRequested || (!isBootstrap && seq > 0 && seq < latestInputSeq)) break;
          await audioPump.writePcm16le(pcmChunk);
        }
      } else {
        await consumeAssistantText();
        const spokenText = toShortSpeechText(assistantText.trim(), 8);
        if (spokenText) {
          try {
            for await (const pcmChunk of ttsService.streamPcm48kForText(spokenText)) {
              if (interruptRequested || (!isBootstrap && seq > 0 && seq < latestInputSeq)) break;
              await audioPump.writePcm16le(pcmChunk);
            }
          } catch (error) {
            console.error(`[agent][${roomName}] buffered TTS failed:`, error?.message || error);
          }
        }
      }
      if (assistantText.trim() && !isInterviewPaused) {
        appendTranscript({ role: 'assistant', by: selectedBotName, text: assistantText.trim(), ts: nowIso() });
      }
    } catch (err) {
      process.stdout.write('\n');
      console.error(`[agent][${roomName}] processUserInput failed:`, err?.message || err);
    } finally {
      if (isBootstrap) {
        // Never leave kickoff incomplete; otherwise later STT turns are ignored indefinitely.
        kickoffTurnCompleted = true;
      }
      assistantState = 'idle';
    }
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
    if (isRealtimeScreeningAgent && sourceIdentity !== 'stdin' && sourceIdentity !== 'simulated') return;
    const cleaned = String(text || '').trim();
    if (!cleaned) return;

    latestInputSeq += 1;
    inputQueue.push({
      text: cleaned,
      sourceIdentity: sourceIdentity || 'participant',
      seq: latestInputSeq,
    });

    queueWorker = queueWorker.then(drainInputQueue).catch((err) => {
      assistantState = 'idle';
      console.error(`[agent][${roomName}] generation error:`, err);
    });
  };

  const startRemoteAudioTranscription = (track, participant) => {
    const streamKey = `${participant.identity}:${track.sid ?? 'audio'}`;
    if (activeInputStreams.has(streamKey)) return;

    if (isRealtimeScreeningAgent) {
      console.log(`[direct][${roomName}] realtime_screening passive mode skipping transcription for '${participant.identity}'`);
      return;
    }

    const stream = new AudioStream(track, {
      sampleRate: STT_SAMPLE_RATE,
      numChannels: STT_CHANNELS,
      frameSizeMs: 20,
    });
    const reader = stream.getReader();

    const turnDetector = new SpeechTurnDetector({
      transcriptionService,
      participantIdentity: participant.identity,
      ...sttTurnConfig,
      onTranscription: async (text) => {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!kickoffTurnCompleted) {
          if (!kickoffRecoveryRequested) {
            kickoffRecoveryRequested = true;
            console.log(`[agent][${roomName}] kickoff recovery triggered from STT`);
            queueUserTurn('__bootstrap_interview_start__', 'agent_bootstrap');
          }
          console.log(
            `[stt][${roomName}][${participant.identity}] ignored input before kickoff turn completed: "${normalized}"`,
          );
          return;
        }
        if (assistantState === 'speaking') {
          if (!isRealtimeScreeningAgent && !ALLOW_CLASSIC_BARGE_IN_DURING_SPEAKING) {
            const isExplicitInterrupt = /\b(stop|pause|hold on|wait|one second|excuse me)\b/i.test(normalized);
            if (!isExplicitInterrupt) {
              console.log(
                `[stt][${roomName}][${participant.identity}] ignored barge-in while assistant speaking (classic mode): "${normalized}"`,
              );
              return;
            }
          }
          const words = normalized ? normalized.split(/\s+/).length : 0;
          const chars = normalized.length;
          const looksLikeLowSignal = words < BARGE_IN_MIN_WORDS && chars < BARGE_IN_MIN_CHARS;
          if (looksLikeLowSignal) {
            console.log(
              `[stt][${roomName}][${participant.identity}] ignored low-signal barge-in while assistant speaking: "${normalized}"`,
            );
            return;
          }
        }
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

    try {
      const raw = TEXT_DECODER.decode(payload).trim();
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed?.type === 'client_media_state') {
          void publishPauseState();
          return;
        }
        if (parsed?.type === 'agent_control') {
          if (!isModeratorParticipant(participant)) return;
          const action = String(parsed?.action || '').trim().toLowerCase();
          if (action === 'pause') {
            isInterviewPaused = true;
            requestInterruption();
            void publishPauseState();
          } else if (action === 'resume') {
            isInterviewPaused = false;
            void publishPauseState();
          }
          return;
        }
      }
    } catch {
      // Ignore control parsing errors and continue with normal payload flow.
    }

    if (isInterviewPaused) return;

    const parsed = extractPayload(payload);
    const text = parsed.text;
    if (parsed.contextUpdated || parsed.metadataUpdated || parsed.interviewStateUpdated) {
      console.log(`[agent][${roomName}] updated interview context metadata from data payload`);
      if (parsed.interviewStateUpdated && interviewState.currentSkill) {
        setCurrentSkill(interviewState.currentSkill, interviewState.currentQuestion, interviewState.currentTopic);
      }
    }
    if (!text || isRealtimeScreeningAgent) return;

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
  if (room.remoteParticipants.size > 0) {
    for (const participant of room.remoteParticipants.values()) {
      handleParticipantConnected(participant, 'post_connect_scan');
    }
  }
  if (isRealtimeScreeningAgent) {
    console.log(`[agent][${roomName}] realtime_screening direct mode active (passive tile/control only)`);
  }
  await publishPauseState();
  controlStateInterval = setInterval(() => {
    void publishPauseState();
  }, 700);

  const audioSource = new AudioSource(TARGET_SAMPLE_RATE, TARGET_CHANNELS);
  const localTrack = LocalAudioTrack.createAudioTrack('ai-agent-audio', audioSource);
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(localTrack, publishOptions);
  console.log(`[agent] published audio track in '${roomName}'`);

  audioPump = new PcmAudioPump(audioSource, {
    maxQueueSeconds: AUDIO_PUMP_MAX_QUEUE_SECONDS,
  });
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

  async function stop(reason = 'manual') {
    if (stopped || stopping) return;
    if (reason === 'screening_time_limit') {
      try {
        const payload = Buffer.from(
          JSON.stringify({
            type: 'interview_notice',
            reason,
            level: 'info',
            message:
              'Interview time limit reached. Wrapping up now and saving your transcript and report.',
            ts: nowIso(),
          }),
        );
        await room.localParticipant.publishData(payload, { reliable: true });
      } catch (err) {
        console.warn(`[agent][${roomName}] failed to publish interview notice:`, err?.message || err);
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (
      (reason === 'room_empty' || reason === 'idle_timeout') &&
      room.remoteParticipants.size > 0
    ) {
      console.log(
        `[agent][${roomName}] aborting stop '${reason}' because participants rejoined (${room.remoteParticipants.size})`,
      );
      scheduleIdleStop();
      return;
    }
    stopping = true;
    if (controlStateInterval) {
      clearInterval(controlStateInterval);
      controlStateInterval = null;
    }
    console.log(`[agent] stopping room '${roomName}' (${reason})`);

    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (emptyRoomStopTimer) {
      clearTimeout(emptyRoomStopTimer);
      emptyRoomStopTimer = null;
    }
    if (state.screeningHardStopTimer) {
      clearTimeout(state.screeningHardStopTimer);
      state.screeningHardStopTimer = null;
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
  }

  function scheduleIdleStop() {
    if (stopping || stopped || ROOM_IDLE_TIMEOUT_MS <= 0) return;
    if (room.remoteParticipants.size > 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stop('idle_timeout').catch((err) => {
        console.error(`[agent][${roomName}] idle stop failed:`, err);
      });
    }, ROOM_IDLE_TIMEOUT_MS);
  }

  scheduleIdleStop();

  return {
    roomName,
    identity,
    agentType: selectedAgentType,
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
  const key = String(process.env.OPENAI_API_KEY || '');
  const keyFingerprint = key ? `${key.slice(0, 12)}...${key.slice(-6)}` : 'missing';
  console.log(
    `[agent-manager] boot config: key=${keyFingerprint} model=${process.env.OPENAI_MODEL || 'gpt-4o-mini'} ` +
      `realtimeModel=${process.env.OPENAI_REALTIME_SCREENING_MODEL || 'gpt-realtime-mini'} ` +
      `agentMediaMode=${process.env.AGENT_MEDIA_MODE || 'direct'} cwd=${process.cwd()}`,
  );

  const sessions = new Map();
  const pendingJoins = new Map();
  let shuttingDown = false;
  const resetSessionOnJoin =
    process.env.AGENT_RESET_SESSION_ON_JOIN === 'true' ||
    process.env.AGENT_RESET_SESSION_ON_JOIN === '1';

  const ensureSession = async (
    roomName,
    { interactiveStdin = false, reason = 'api', agentType = AGENT_TYPE_CLASSIC } = {},
  ) => {
    const targetRoomName = String(roomName || '').trim();
    const normalized = normalizeRoomName(targetRoomName);
    if (!targetRoomName || !normalized) {
      throw new Error('roomName is required');
    }
    const roomKey = normalized;
    const requestedAgentType = normalizeAgentType(agentType);
    const requestedIdentity = botIdentityForRoom(targetRoomName, requestedAgentType);

    const shouldResetExisting =
      resetSessionOnJoin && (reason === 'control-api' || reason === 'startup-default-room');

    if (sessions.has(roomKey)) {
      const existing = sessions.get(roomKey);
      const typeChanged = existing?.agentType && existing.agentType !== requestedAgentType;
      const shouldReset = shouldResetExisting || typeChanged;
      if (!shouldReset) {
        await evictStaleBotParticipants(targetRoomName, existing?.identity || requestedIdentity);
        return { roomName: targetRoomName, status: 'already_joined', agentType: requestedAgentType };
      }

      sessions.delete(roomKey);
      if (existing && typeof existing.stop === 'function') {
        await existing.stop('reset_on_join').catch((err) => {
          console.error(`[agent-manager] failed to reset room '${targetRoomName}':`, err);
        });
      }
    }

    if (pendingJoins.has(roomKey)) {
      await pendingJoins.get(roomKey);
      if (sessions.has(roomKey) && !shouldResetExisting) {
        const existing = sessions.get(roomKey);
        if (!existing || existing.agentType === requestedAgentType) {
          await evictStaleBotParticipants(targetRoomName, existing?.identity || requestedIdentity);
          return { roomName: targetRoomName, status: 'already_joined', agentType: requestedAgentType };
        }
      }
    }

    await evictStaleBotParticipants(targetRoomName, requestedIdentity);

    console.log(
      `[agent-manager] joining room '${targetRoomName}' as '${requestedAgentType}' (reason: ${reason})`,
    );

    const joinTask = createAgentSession(targetRoomName, {
      interactiveStdin,
      agentType: requestedAgentType,
      onStop: (name) => {
        sessions.delete(roomKey);
        console.log(`[agent-manager] room session removed: '${name}'`);
      },
    })
      .then((session) => {
        sessions.set(roomKey, session);
      })
      .finally(() => {
        pendingJoins.delete(roomKey);
      });

    pendingJoins.set(roomKey, joinTask);
    await joinTask;

    return { roomName: targetRoomName, status: 'joined', agentType: requestedAgentType };
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
            rooms: Array.from(sessions.values()).map((session) => ({
              roomName: session.roomName,
              agentType: session.agentType || AGENT_TYPE_CLASSIC,
            })),
            pendingRooms: Array.from(pendingJoins.keys()),
          });
          return;
        }

        if (req.method === 'POST' && path === '/join') {
          const body = await readJsonBody(req);
          const roomName = body?.roomName;
          const result = await ensureSession(roomName, {
            reason: 'control-api',
            agentType: body?.agentType,
          });
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
