import { getInterview, updateInterview } from '@/lib/server/interviewStore';
import { NextRequest, NextResponse } from 'next/server';

type TranscriptRole = 'candidate' | 'agent' | 'system' | 'unknown';

type TranscriptEntry = {
  role?: TranscriptRole;
  text?: string;
  ts?: string | number;
};

const MAX_BATCH_ENTRIES = 200;
const MAX_TEXT_LENGTH = 1200;
const MAX_TRANSCRIPT_CHARS = 500_000;

function normalizeRole(value: unknown): TranscriptRole {
  const role = String(value || '')
    .trim()
    .toLowerCase();
  if (role === 'candidate' || role === 'agent' || role === 'system') return role;
  return 'unknown';
}

function roleLabel(role: TranscriptRole): string {
  if (role === 'candidate') return 'Candidate';
  if (role === 'agent') return 'Interviewer Bot';
  if (role === 'system') return 'System';
  return 'Unknown';
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function trimTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  return text.slice(text.length - MAX_TRANSCRIPT_CHARS);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      entries?: TranscriptEntry[];
    };
    const rawEntries = Array.isArray(body.entries) ? body.entries.slice(0, MAX_BATCH_ENTRIES) : [];
    if (rawEntries.length === 0) {
      return NextResponse.json({ error: 'Missing transcript entries' }, { status: 400 });
    }

    const interview = await getInterview(id);
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const lines = rawEntries
      .map((entry) => {
        const text = normalizeText(entry?.text);
        if (!text) return '';
        const role = normalizeRole(entry?.role);
        const ts = normalizeTimestamp(entry?.ts);
        return `[${ts}] ${roleLabel(role)}: ${text}`;
      })
      .filter(Boolean);

    if (lines.length === 0) {
      return NextResponse.json({ ok: true, added: 0 });
    }

    const existing = String(interview.transcriptText || '').trim();
    const combined = trimTranscript([existing, ...lines].filter(Boolean).join('\n'));
    await updateInterview(id, { transcriptText: combined });

    return NextResponse.json({
      ok: true,
      added: lines.length,
      transcriptChars: combined.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to append transcript';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
