import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getPrismaClient } from '@/lib/server/prismaClient';

export const DEFAULT_CLASSIC_AGENT_PROMPT = [
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
].join(' ');

export const DEFAULT_REALTIME_SCREENING_AGENT_PROMPT = [
  'You are a conversational screening interviewer for a strict 10-minute live call.',
  'Keep the tone natural and human, but be efficient and focused.',
  'Flow:',
  '1) 30-45s intro and consent.',
  '2) 2-3 concise background and relevance questions.',
  '3) One practical project probe for depth and ownership.',
  '4) A few short technical theory checks for coverage.',
  '5) Brief close and next-step summary.',
  'Rules:',
  '- Ask one question at a time.',
  '- Do not repeat the same question more than once.',
  '- If candidate says skip or does not know, acknowledge and move on.',
  '- Keep responses short and spoken-friendly.',
].join(' ');

export const DEFAULT_SCREENING_MAX_MINUTES = 10;
export const DEFAULT_STT_VAD_RMS_THRESHOLD = 0.005;
export const DEFAULT_STT_MIN_SPEECH_MS = 350;
export const DEFAULT_STT_MAX_SILENCE_MS = 2200;
export const DEFAULT_STT_MAX_UTTERANCE_MS = 30000;
export const DEFAULT_STT_MIN_TRANSCRIBE_MS = 1000;
export const DEFAULT_STT_GRACE_MS = 350;

export type AgentPromptSettings = {
  classicPrompt: string;
  realtimePrompt: string;
  screeningMaxMinutes: number;
  sttVadRmsThreshold: number;
  sttMinSpeechMs: number;
  sttMaxSilenceMs: number;
  sttMaxUtteranceMs: number;
  sttMinTranscribeMs: number;
  sttGraceMs: number;
  updatedAt: string;
};

const baseDir =
  process.env.INTERVIEW_DATA_DIR ?? path.join(os.homedir(), '.bristlecone-data', 'interviews');
const settingsPath = path.join(baseDir, 'agent-settings.json');

type AgentPromptSettingsPayload = Partial<AgentPromptSettings>;
let bootstrapped = false;

function sanitizePrompt(value: string, fallback: string): string {
  const compact = String(value || '').replace(/\r/g, '\n').trim();
  if (!compact) return fallback;
  return compact.slice(0, 12000);
}

function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function ensureStoreDir() {
  await mkdir(baseDir, { recursive: true });
}

function normalizeSettings(input?: AgentPromptSettingsPayload): AgentPromptSettings {
  const parsed = input || {};
  return {
    classicPrompt: sanitizePrompt(parsed.classicPrompt || '', DEFAULT_CLASSIC_AGENT_PROMPT),
    realtimePrompt: sanitizePrompt(parsed.realtimePrompt || '', DEFAULT_REALTIME_SCREENING_AGENT_PROMPT),
    screeningMaxMinutes: sanitizeNumber(parsed.screeningMaxMinutes, DEFAULT_SCREENING_MAX_MINUTES, 1, 180),
    sttVadRmsThreshold: sanitizeNumber(parsed.sttVadRmsThreshold, DEFAULT_STT_VAD_RMS_THRESHOLD, 0.0001, 0.1),
    sttMinSpeechMs: sanitizeNumber(parsed.sttMinSpeechMs, DEFAULT_STT_MIN_SPEECH_MS, 1, 10000),
    sttMaxSilenceMs: sanitizeNumber(parsed.sttMaxSilenceMs, DEFAULT_STT_MAX_SILENCE_MS, 100, 20000),
    sttMaxUtteranceMs: sanitizeNumber(parsed.sttMaxUtteranceMs, DEFAULT_STT_MAX_UTTERANCE_MS, 1000, 120000),
    sttMinTranscribeMs: sanitizeNumber(parsed.sttMinTranscribeMs, DEFAULT_STT_MIN_TRANSCRIBE_MS, 100, 10000),
    sttGraceMs: sanitizeNumber(parsed.sttGraceMs, DEFAULT_STT_GRACE_MS, 0, 10000),
    updatedAt: String(parsed.updatedAt || '').trim() || new Date(0).toISOString(),
  };
}

async function readFileSettings(): Promise<AgentPromptSettings> {
  await ensureStoreDir();
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as AgentPromptSettingsPayload;
    return normalizeSettings(parsed);
  } catch {
    return normalizeSettings();
  }
}

async function writeFileSettings(next: AgentPromptSettings): Promise<void> {
  await ensureStoreDir();
  await writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf8');
}

async function bootstrapFromFileIfNeeded() {
  if (bootstrapped) return;
  bootstrapped = true;
  const prisma = getPrismaClient();
  if (!prisma) return;
  try {
    const existing = await prisma.agentSetting.findUnique({ where: { id: 1 } });
    if (existing) return;
    const fileSettings = await readFileSettings();
    await prisma.agentSetting.create({
      data: {
        id: 1,
        payload: fileSettings,
        updatedAt: new Date(fileSettings.updatedAt),
      },
    });
  } catch (error) {
    console.warn('[storage] agent settings bootstrap fallback to file store:', error);
  }
}

export async function getAgentPromptSettings(): Promise<AgentPromptSettings> {
  await bootstrapFromFileIfNeeded();
  const prisma = getPrismaClient();
  if (!prisma) return readFileSettings();
  try {
    const row = await prisma.agentSetting.findUnique({ where: { id: 1 } });
    if (!row) return normalizeSettings();
    return normalizeSettings(row.payload as AgentPromptSettingsPayload);
  } catch {
    return readFileSettings();
  }
}

export async function updateAgentPromptSettings(
  input: Partial<
    Pick<
      AgentPromptSettings,
      | 'classicPrompt'
      | 'realtimePrompt'
      | 'screeningMaxMinutes'
      | 'sttVadRmsThreshold'
      | 'sttMinSpeechMs'
      | 'sttMaxSilenceMs'
      | 'sttMaxUtteranceMs'
      | 'sttMinTranscribeMs'
      | 'sttGraceMs'
    >
  >,
): Promise<AgentPromptSettings> {
  const current = await getAgentPromptSettings();
  const next: AgentPromptSettings = {
    classicPrompt:
      typeof input.classicPrompt === 'string'
        ? sanitizePrompt(input.classicPrompt, DEFAULT_CLASSIC_AGENT_PROMPT)
        : current.classicPrompt,
    realtimePrompt:
      typeof input.realtimePrompt === 'string'
        ? sanitizePrompt(input.realtimePrompt, DEFAULT_REALTIME_SCREENING_AGENT_PROMPT)
        : current.realtimePrompt,
    screeningMaxMinutes:
      typeof input.screeningMaxMinutes === 'number'
        ? sanitizeNumber(input.screeningMaxMinutes, current.screeningMaxMinutes, 1, 180)
        : current.screeningMaxMinutes,
    sttVadRmsThreshold:
      typeof input.sttVadRmsThreshold === 'number'
        ? sanitizeNumber(input.sttVadRmsThreshold, current.sttVadRmsThreshold, 0.0001, 0.1)
        : current.sttVadRmsThreshold,
    sttMinSpeechMs:
      typeof input.sttMinSpeechMs === 'number'
        ? sanitizeNumber(input.sttMinSpeechMs, current.sttMinSpeechMs, 1, 10000)
        : current.sttMinSpeechMs,
    sttMaxSilenceMs:
      typeof input.sttMaxSilenceMs === 'number'
        ? sanitizeNumber(input.sttMaxSilenceMs, current.sttMaxSilenceMs, 100, 20000)
        : current.sttMaxSilenceMs,
    sttMaxUtteranceMs:
      typeof input.sttMaxUtteranceMs === 'number'
        ? sanitizeNumber(input.sttMaxUtteranceMs, current.sttMaxUtteranceMs, 1000, 120000)
        : current.sttMaxUtteranceMs,
    sttMinTranscribeMs:
      typeof input.sttMinTranscribeMs === 'number'
        ? sanitizeNumber(input.sttMinTranscribeMs, current.sttMinTranscribeMs, 100, 10000)
        : current.sttMinTranscribeMs,
    sttGraceMs:
      typeof input.sttGraceMs === 'number'
        ? sanitizeNumber(input.sttGraceMs, current.sttGraceMs, 0, 10000)
        : current.sttGraceMs,
    updatedAt: new Date().toISOString(),
  };

  const prisma = getPrismaClient();
  if (!prisma) {
    await writeFileSettings(next);
    return next;
  }
  try {
    await prisma.agentSetting.upsert({
      where: { id: 1 },
      create: { id: 1, payload: next, updatedAt: new Date(next.updatedAt) },
      update: { payload: next, updatedAt: new Date(next.updatedAt) },
    });
    return next;
  } catch {
    await writeFileSettings(next);
    return next;
  }
}
