import { NextRequest, NextResponse } from 'next/server';

type UtteranceClass =
  | 'VOICE_CONTROL'
  | 'INTERVIEW_RELEVANT'
  | 'GOOD_TO_HAVE_DRIFT'
  | 'OFF_TOPIC'
  | 'UNCLEAR';

type GateAction = 'ALLOW' | 'REDIRECT';

function toList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function findMatchingSkill(text: string, skills: string[]): string {
  for (const skill of skills) {
    const normalized = String(skill || '').trim();
    if (!normalized) continue;
    if (text.includes(normalized.toLowerCase())) return normalized;
  }
  return '';
}

function parseVoiceControls(text: string): string[] {
  const controls: string[] = [];
  if (/\b(slower|slow down)\b/.test(text)) controls.push('speak slower');
  if (/\b(faster|speed up)\b/.test(text)) controls.push('speak faster');
  if (/\b(louder|increase volume|speak up)\b/.test(text)) controls.push('speak louder');
  if (/\b(softer|quieter|lower volume)\b/.test(text)) controls.push('speak softer');
  if (/\b(accent|british|american|indian|australian)\b/.test(text)) controls.push('adjust accent');
  if (/\b(repeat|say that again)\b/.test(text)) controls.push('repeat');
  if (/\b(rephrase|paraphrase)\b/.test(text)) controls.push('rephrase');
  if (/\b(pause)\b/.test(text)) controls.push('pause');
  if (/\b(resume|continue)\b/.test(text)) controls.push('resume');
  return controls;
}

function classifyUtterance({
  text,
  currentSkill,
  mustHaveSkills,
  requiredTechStack,
  goodToHaveSkills,
}: {
  text: string;
  currentSkill: string;
  mustHaveSkills: string[];
  requiredTechStack: string[];
  goodToHaveSkills: string[];
}): { classification: UtteranceClass; driftSkill: string; voiceControls: string[] } {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return { classification: 'UNCLEAR', driftSkill: '', voiceControls: [] };

  const voiceControls = parseVoiceControls(normalized);
  if (voiceControls.length > 0) {
    return { classification: 'VOICE_CONTROL', driftSkill: '', voiceControls };
  }

  const explicitPivot = /\b(let'?s talk about|can we talk about|switch to|move to|focus on|ask about)\b/.test(
    normalized,
  );
  const driftSkill = findMatchingSkill(normalized, goodToHaveSkills);
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

  const allInterviewTerms = [currentSkill, ...mustHaveSkills, ...requiredTechStack]
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const hasInterviewSignal = allInterviewTerms.some((term) => normalized.includes(term));
  if (hasInterviewSignal) {
    return { classification: 'INTERVIEW_RELEVANT', driftSkill: '', voiceControls: [] };
  }

  if (normalized.split(/\s+/).filter(Boolean).length <= 2) {
    return { classification: 'UNCLEAR', driftSkill: '', voiceControls: [] };
  }

  return { classification: 'INTERVIEW_RELEVANT', driftSkill: '', voiceControls: [] };
}

function buildRedirectPrefix(): string {
  return "I hear you. I'll keep us focused on the interview.";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body?.text || '').trim();
    const currentQuestion = String(body?.currentQuestion || '').trim();
    const currentSkill = String(body?.currentSkill || '').trim();
    const currentTopic = String(body?.currentTopic || '').trim();
    const mustHaveSkills = toList(body?.mustHaveSkills);
    const requiredTechStack = toList(body?.requiredTechStack);
    const goodToHaveSkills = toList(body?.goodToHaveSkills);
    const activeSkill = currentSkill || mustHaveSkills[0] || '';
    const activeTopic = currentTopic || activeSkill;

    const { classification, driftSkill, voiceControls } = classifyUtterance({
      text,
      currentSkill: activeSkill,
      mustHaveSkills,
      requiredTechStack,
      goodToHaveSkills,
    });

    let action: GateAction = 'ALLOW';
    let systemMessage = '';

    if (classification === 'VOICE_CONTROL') {
      action = 'REDIRECT';
      const controlPhrase = voiceControls.length > 0 ? `Requested voice controls: ${voiceControls.join(', ')}.` : '';
      const backTo = currentQuestion
        ? `Continuing: ${currentQuestion}`
        : `Let's go back to ${activeSkill || 'the current must-have skill'}.`;
      systemMessage = `Interview mode. ${controlPhrase} Respond in 1-2 sentences: "${buildRedirectPrefix()} ${backTo}" Then continue strictly on ${activeSkill || 'the active must-have skill'}.`;
    } else if (classification === 'OFF_TOPIC') {
      action = 'REDIRECT';
      const backTo = currentQuestion
        ? `Continuing: ${currentQuestion}`
        : `Let's go back to ${activeSkill || 'the current must-have skill'}.`;
      systemMessage = `Interview mode. Do not answer off-topic request. Respond in 1-2 sentences: "${buildRedirectPrefix()} ${backTo}"`;
    } else if (classification === 'GOOD_TO_HAVE_DRIFT') {
      action = 'REDIRECT';
      const redirectSkill = activeSkill || mustHaveSkills[0] || 'the current must-have skill';
      const driftLabel = driftSkill || activeTopic || 'a good-to-have topic';
      const backTo = currentQuestion
        ? `Continuing: ${currentQuestion}`
        : `Let's go back to ${redirectSkill}.`;
      systemMessage = `Candidate is drifting to good-to-have topic: ${driftLabel}. Redirect back to must-have skill: ${redirectSkill}. Respond in 1-2 sentences: "${buildRedirectPrefix()} ${backTo}"`;
    } else if (classification === 'UNCLEAR') {
      action = 'ALLOW';
      const skillLabel = activeSkill || 'the active must-have skill';
      systemMessage = `Interview mode. Treat the last candidate input as unclear; ask one concise clarifying question tied to ${skillLabel}.`;
    }

    return NextResponse.json({
      ok: true,
      classification,
      action,
      systemMessage,
      currentQuestion,
      currentSkill: activeSkill,
      currentTopic: activeTopic,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Failed to classify turn');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
