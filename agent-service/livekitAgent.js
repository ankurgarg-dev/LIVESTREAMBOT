require('dotenv').config();

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
      // captureFrame is intentionally awaited to respect audio pacing and downstream backpressure.
      await this.audioSource.captureFrame(frame);
    }
  }

  async stop() {
    this.running = false;
    this._notifyData();
    this._notifySpace();
    await this.pumpTask.catch(() => undefined);
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
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
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
    maxSilenceMs = Number(process.env.STT_MAX_SILENCE_MS || 900),
    maxUtteranceMs = Number(process.env.STT_MAX_UTTERANCE_MS || 12000),
    minTranscribeMs = Number(process.env.STT_MIN_TRANSCRIBE_MS || 300),
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

async function startAgent() {
  const roomName = process.env.LIVEKIT_ROOM || 'demo-room';
  const identity = process.env.BOT_IDENTITY || 'bristlecone-ai-agent';
  const displayName = process.env.BOT_NAME || 'Bristlecone AI Agent';

  const livekitUrl = normalizeLiveKitUrl(process.env.LIVEKIT_URL);
  const token = await createJoinToken({ roomName, identity, name: displayName });

  const room = new Room();

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log(`[room] participant connected: ${participant.identity}`);
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.log(`[room] participant disconnected: ${participant.identity}`);
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log('[room] disconnected');
  });

  await room.connect(livekitUrl, token);
  console.log(`[agent] connected to room '${roomName}' as '${identity}'`);

  const audioSource = new AudioSource(TARGET_SAMPLE_RATE, TARGET_CHANNELS);
  const localTrack = LocalAudioTrack.createAudioTrack('ai-agent-audio', audioSource);
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(localTrack, publishOptions);
  console.log('[agent] published audio track');

  const audioPump = new PcmAudioPump(audioSource);

  const llmService = new LLMService({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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

  let generationChain = Promise.resolve();
  const activeInputStreams = new Map();

  const extractTextPayload = (payload) => {
    try {
      const raw = TEXT_DECODER.decode(payload).trim();
      if (!raw) return null;

      // Accept raw text and common JSON chat/data shapes.
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        const maybeText =
          parsed?.text ??
          parsed?.message ??
          parsed?.content ??
          parsed?.body?.text ??
          parsed?.payload?.text;
        return typeof maybeText === 'string' ? maybeText.trim() : null;
      }

      return raw;
    } catch {
      return null;
    }
  };

  const processUserInput = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    console.log(`\n[user] ${trimmed}`);
    const llmStream = llmService.streamAssistantReply(trimmed);

    const loggingLlmStream = (async function* () {
      process.stdout.write('[assistant] ');
      for await (const delta of llmStream) {
        process.stdout.write(delta);
        yield delta;
      }
      process.stdout.write('\n');
    })();

    for await (const pcmChunk of ttsService.streamFromLlmText(loggingLlmStream)) {
      await audioPump.writePcm16le(pcmChunk);
    }
  };

  const enqueueInput = (text) => {
    generationChain = generationChain
      .then(() => processUserInput(text))
      .catch((err) => {
        console.error('[agent] generation error:', err);
      });
  };

  room.on(RoomEvent.DataReceived, (payload, participant) => {
    if (!participant) return;
    if (participant.identity === identity) return;

    const text = extractTextPayload(payload);
    if (!text) return;

    console.log(`\n[data][${participant.identity}] ${text}`);
    enqueueInput(text);
  });

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
        enqueueInput(text);
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
        console.error(`[stt][${participant.identity}] audio stream error:`, err);
      } finally {
        await turnDetector.flush('stream_end');
      }
    })();

    activeInputStreams.set(streamKey, {
      reader,
      turnDetector,
      readLoop,
    });

    console.log(`[stt] subscribed to audio for participant '${participant.identity}'`);
  };

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (!participant || participant.identity === identity) return;
    if (!(track instanceof RemoteAudioTrack)) return;

    startRemoteAudioTranscription(track, participant);
  });

  room.on(RoomEvent.TrackUnsubscribed, async (track, publication, participant) => {
    if (!participant || participant.identity === identity) return;
    const streamKey = `${participant.identity}:${track.sid ?? 'audio'}`;
    const active = activeInputStreams.get(streamKey);
    if (!active) return;

    activeInputStreams.delete(streamKey);
    try {
      await active.reader.cancel();
    } catch {
      // Ignore reader cancellation errors during teardown.
    }
  });

  if (process.env.SIMULATED_INPUT && process.env.SIMULATED_INPUT.trim()) {
    enqueueInput(process.env.SIMULATED_INPUT);
  }

  const stdinEnabled = process.env.ENABLE_STDIN !== 'false';
  let rl = null;
  if (stdinEnabled) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    console.log('[agent] stdin enabled; type a message and press enter to respond in-room');
    rl.on('line', (line) => {
      enqueueInput(line);
    });
  }
  console.log('[agent] listening for LiveKit data messages from participants');
  console.log('[agent] listening for remote participant speech (server-side STT)');

  const shutdown = async () => {
    console.log('\n[agent] shutting down...');
    if (rl) rl.close();

    for (const active of activeInputStreams.values()) {
      try {
        await active.reader.cancel();
      } catch {
        // Ignore cancellation errors during shutdown.
      }
    }
    activeInputStreams.clear();

    await generationChain.catch(() => undefined);
    await audioPump.stop();

    try {
      await room.disconnect();
    } catch (err) {
      console.error('[agent] room disconnect error:', err);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startAgent().catch((err) => {
  console.error('[agent] fatal error:', err);
  process.exit(1);
});
