import { getAgentPromptSettings, updateAgentPromptSettings } from '@/lib/server/agentPromptSettingsStore';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const settings = await getAgentPromptSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load agent settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      classicPrompt?: string;
      realtimePrompt?: string;
      screeningMaxMinutes?: number;
      sttVadRmsThreshold?: number;
      sttMinSpeechMs?: number;
      sttMaxSilenceMs?: number;
      sttMaxUtteranceMs?: number;
      sttMinTranscribeMs?: number;
      sttGraceMs?: number;
    };
    const settings = await updateAgentPromptSettings({
      classicPrompt: typeof body.classicPrompt === 'string' ? body.classicPrompt : undefined,
      realtimePrompt: typeof body.realtimePrompt === 'string' ? body.realtimePrompt : undefined,
      screeningMaxMinutes:
        typeof body.screeningMaxMinutes === 'number' ? body.screeningMaxMinutes : undefined,
      sttVadRmsThreshold:
        typeof body.sttVadRmsThreshold === 'number' ? body.sttVadRmsThreshold : undefined,
      sttMinSpeechMs: typeof body.sttMinSpeechMs === 'number' ? body.sttMinSpeechMs : undefined,
      sttMaxSilenceMs:
        typeof body.sttMaxSilenceMs === 'number' ? body.sttMaxSilenceMs : undefined,
      sttMaxUtteranceMs:
        typeof body.sttMaxUtteranceMs === 'number' ? body.sttMaxUtteranceMs : undefined,
      sttMinTranscribeMs:
        typeof body.sttMinTranscribeMs === 'number' ? body.sttMinTranscribeMs : undefined,
      sttGraceMs: typeof body.sttGraceMs === 'number' ? body.sttGraceMs : undefined,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update agent settings';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
