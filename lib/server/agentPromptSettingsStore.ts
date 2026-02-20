import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export type AgentPromptSettings = {
  classicPrompt: string;
  realtimePrompt: string;
  updatedAt: string;
};

const baseDir = process.env.INTERVIEW_DATA_DIR ?? path.join('/tmp', 'bristlecone-interviews');
const settingsPath = path.join(baseDir, 'agent-settings.json');

type AgentPromptSettingsPayload = Partial<AgentPromptSettings>;

function sanitizePrompt(value: string, fallback: string): string {
  const compact = String(value || '').replace(/\r/g, '\n').trim();
  if (!compact) return fallback;
  return compact.slice(0, 12000);
}

async function ensureStoreDir() {
  await mkdir(baseDir, { recursive: true });
}

export async function getAgentPromptSettings(): Promise<AgentPromptSettings> {
  await ensureStoreDir();
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as AgentPromptSettingsPayload;
    return {
      classicPrompt: sanitizePrompt(parsed.classicPrompt || '', DEFAULT_CLASSIC_AGENT_PROMPT),
      realtimePrompt: sanitizePrompt(parsed.realtimePrompt || '', DEFAULT_REALTIME_SCREENING_AGENT_PROMPT),
      updatedAt: String(parsed.updatedAt || '').trim() || new Date(0).toISOString(),
    };
  } catch {
    return {
      classicPrompt: DEFAULT_CLASSIC_AGENT_PROMPT,
      realtimePrompt: DEFAULT_REALTIME_SCREENING_AGENT_PROMPT,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export async function updateAgentPromptSettings(
  input: Partial<Pick<AgentPromptSettings, 'classicPrompt' | 'realtimePrompt'>>,
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
    updatedAt: new Date().toISOString(),
  };
  await ensureStoreDir();
  await writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
