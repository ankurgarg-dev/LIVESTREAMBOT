import { NextRequest, NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

type InterviewJobMetadata = {
  mustHaveSkills: string[];
  requiredTechStack: string[];
  goodToHaveSkills: string[];
};

type InterviewState = {
  currentQuestion?: string;
  currentSkill?: string;
  currentTopic?: string;
};

function toSkillList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function buildRealtimeInstruction({
  candidateContext,
  roleContext,
  jobMetadata,
  interviewState,
}: {
  candidateContext?: string;
  roleContext?: string;
  jobMetadata?: InterviewJobMetadata;
  interviewState?: InterviewState;
}): string {
  const mustHaveSkills = toSkillList(jobMetadata?.mustHaveSkills);
  const requiredTechStack = toSkillList(jobMetadata?.requiredTechStack);
  const goodToHaveSkills = toSkillList(jobMetadata?.goodToHaveSkills);
  const currentSkill = String(interviewState?.currentSkill || '').trim();
  const currentQuestion = String(interviewState?.currentQuestion || '').trim();
  const currentTopic = String(interviewState?.currentTopic || '').trim();

  const parts = [
    'You are a structured realtime interview agent. Stay strictly in interview mode.',
    'Allowed content only: interview questions, interview follow-ups, clarifications about the current question, and voice-control requests (pace/accent/volume/repeat/rephrase/pause/resume).',
    'Disallowed content: jokes, entertainment, trivia/general knowledge, personal advice, and unrelated chat. Refuse briefly and redirect back to the interview.',
    'Must-have focus policy: spend the majority of probing on must-have skills. Use required tech stack only to validate must-have depth. Defer good-to-have topics unless explicitly switched later by the orchestrator.',
    'Context discipline: evaluate one specific must-have skill at a time. Keep each turn tightly scoped to the current skill. If candidate pivots away, redirect immediately.',
    'Redirect style: brief acknowledgment, boundary, then redirect. Keep redirect responses to 1-2 sentences.',
  ];
  const cv = String(candidateContext || '').trim();
  const role = String(roleContext || '').trim();
  const metadataBlock = JSON.stringify(
    {
      mustHaveSkills,
      requiredTechStack,
      goodToHaveSkills,
      currentSkill,
      currentQuestion,
      currentTopic,
    },
    null,
    2,
  );
  parts.push(`Interview metadata:\n${metadataBlock}`);
  if (cv) parts.push(`Candidate context:\n${cv.slice(0, 4000)}`);
  if (role) parts.push(`Role context:\n${role.slice(0, 2500)}`);
  return parts.join('\n\n');
}

export async function POST(request: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY is not configured on server.' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const model = String(body?.model || process.env.OPENAI_REALTIME_SCREENING_MODEL || 'gpt-realtime-mini').trim();
    const voice = String(
      body?.voice || process.env.OPENAI_TTS_VOICE_REALTIME_SCREENING || process.env.OPENAI_TTS_VOICE || 'coral',
    ).trim();
    const instruction = buildRealtimeInstruction({
      candidateContext: body?.candidateContext,
      roleContext: body?.roleContext,
      jobMetadata: {
        mustHaveSkills: toSkillList(body?.mustHaveSkills),
        requiredTechStack: toSkillList(body?.requiredTechStack),
        goodToHaveSkills: toSkillList(body?.goodToHaveSkills),
      },
      interviewState: {
        currentQuestion: String(body?.currentQuestion || '').trim(),
        currentSkill: String(body?.currentSkill || '').trim(),
        currentTopic: String(body?.currentTopic || '').trim(),
      },
    });

    const upstream = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        modalities: ['audio', 'text'],
        instructions: instruction,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: {
          type: 'server_vad',
          create_response: false,
          interrupt_response: true,
        },
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = String(data?.error?.message || data?.message || 'Failed to create realtime session');
      return NextResponse.json({ ok: false, error: message }, { status: upstream.status });
    }

    const ephemeralKey = String(data?.client_secret?.value || '').trim();
    if (!ephemeralKey) {
      return NextResponse.json({ ok: false, error: 'Realtime session did not return a client secret.' }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      model,
      voice,
      ephemeralKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Failed to create realtime session');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
