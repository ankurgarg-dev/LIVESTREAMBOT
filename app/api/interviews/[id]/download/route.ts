import { getInterview } from '@/lib/server/interviewStore';
import { NextRequest, NextResponse } from 'next/server';

function cleanFilename(input: string): string {
  return String(input || 'interview')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'interview';
}

function toText(value: unknown): string {
  return String(value ?? '').trim();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

type Competency = {
  name: string;
  score: number;
  evidence: string;
  strengths: string[];
  concerns: string[];
};

function toDecisionLabel(value: string): string {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'strong_hire') return 'Strong Hire';
  if (v === 'hire') return 'Hire';
  if (v === 'lean_hire') return 'Lean Hire';
  if (v === 'lean_no') return 'Lean No';
  if (v === 'no_hire') return 'No Hire';
  return 'Lean No';
}

function toConfidenceLabel(value: string): string {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'high') return 'High';
  if (v === 'low') return 'Low';
  return 'Medium';
}

function toSignalLabel(value: string): string {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'strong') return 'Strong';
  if (v === 'weak') return 'Weak';
  return 'Moderate';
}

function roleSpecificCompetencies(roleText: string): string[] {
  const role = String(roleText || '').toLowerCase();
  if (/(powerapps|power app|automation|power automate)/.test(role)) {
    return ['Data Integration', 'Security / Access Control'];
  }
  if (/(ml|machine learning|genai|llm|ai)/.test(role)) {
    return ['Modeling & Evaluation', 'MLOps / Deployment'];
  }
  if (/(frontend|ui|react)/.test(role)) {
    return ['Frontend Performance', 'Accessibility & UX'];
  }
  if (/(backend|api|service)/.test(role)) {
    return ['API & Data Modeling', 'Reliability & Scalability'];
  }
  return ['Role-Specific Execution'];
}

function buildDefaultCompetencies(interviewScore: number, transcriptAvailable: boolean, roleText: string): Competency[] {
  const base = clamp(Math.round(interviewScore / 20), 1, 5);
  const evidenceLine = transcriptAvailable
    ? 'Evidence: Transcript available; no curated excerpt stored in this export.'
    : 'Evidence: Not available (no transcript).';
  const names = [
    'Problem Solving & Reasoning',
    'Technical Depth (role-specific)',
    'Solution Design / Architecture',
    'Communication & Clarity',
    'Quality & Reliability (testing, edge cases, maintainability)',
    ...roleSpecificCompetencies(roleText),
  ].slice(0, 7);
  return names.map((name) => ({
    name,
    score: base,
    evidence: evidenceLine,
    strengths: ['Baseline positive signal inferred from available interview report.'],
    concerns: ['Insufficient direct evidence for high-confidence calibration.'],
  }));
}

function buildDerivedAssessment(interview: {
  summaryFeedback?: string;
  detailedFeedback?: string;
  recommendation?: string;
  interviewScore?: number;
  rubricScore?: number;
  nextSteps?: string;
  transcriptText?: string;
  assessmentReport?: unknown;
  jobTitle?: string;
}) {
  const summaryFeedback = toText(interview.summaryFeedback);
  const detailedFeedback = toText(interview.detailedFeedback);
  const recommendation = toText(interview.recommendation);
  const nextSteps = toText(interview.nextSteps);
  const transcript = toText(interview.transcriptText);
  const transcriptLines = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidateLines = transcriptLines.filter((line) => line.includes(':') && !line.includes('Interviewer Bot:'));
  const candidateTurns = candidateLines.length;
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const qualityScore = clamp(Math.round(40 + candidateTurns * 3 + words / 140), 35, 92);
  const fallbackDecision = qualityScore >= 85 ? 'hire' : qualityScore >= 70 ? 'lean_hire' : qualityScore >= 60 ? 'lean_no' : 'no_hire';
  const evidence = candidateLines
    .slice(0, 3)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, ''))
    .map((line) => `- ${line.slice(0, 180)}`)
    .join('\n');
  const transcriptAvailable = transcriptLines.length > 0;
  const structured = (interview.assessmentReport || {}) as Record<string, unknown>;
  const structuredCompetencies = Array.isArray(structured.competencies)
    ? structured.competencies
        .map((item) => {
          const row = item as Record<string, unknown>;
          const name = toText(row.name);
          if (!name) return null;
          return {
            name,
            score: clamp(Number(row.score || 0), 1, 5),
            evidence: toText(row.evidence) || (transcriptAvailable ? 'Evidence: Transcript available; no curated excerpt stored in this export.' : 'Evidence: Not available (no transcript).'),
            strengths: Array.isArray(row.strengths) ? row.strengths.map((x) => toText(x)).filter(Boolean).slice(0, 4) : [],
            concerns: Array.isArray(row.concerns) ? row.concerns.map((x) => toText(x)).filter(Boolean).slice(0, 4) : [],
          };
        })
        .filter(Boolean)
    : [];

  const decisionRaw = toText(structured.recommendationDecision) || (recommendation === 'strong_hire' ? 'strong_hire' : recommendation === 'hire' ? 'hire' : recommendation === 'no_hire' ? 'no_hire' : fallbackDecision);
  const confidenceRaw = toText(structured.confidence) || (qualityScore >= 80 ? 'high' : qualityScore >= 65 ? 'medium' : 'low');
  const signalRaw = toText(structured.overallSignal) || (qualityScore >= 80 ? 'strong' : qualityScore >= 65 ? 'moderate' : 'weak');
  const resolvedInterviewScore =
    typeof interview.interviewScore === 'number' && Number.isFinite(interview.interviewScore)
      ? clamp(Math.round(interview.interviewScore), 0, 100)
      : qualityScore;
  const resolvedRubricScore =
    typeof interview.rubricScore === 'number' && Number.isFinite(interview.rubricScore)
      ? clamp(Number(interview.rubricScore), 0, 10)
      : Number((resolvedInterviewScore / 10).toFixed(1));

  return {
    executiveSummary:
      toText(structured.executiveSummary) ||
      summaryFeedback ||
      (transcript
        ? `Candidate showed partial technical signal across ${candidateTurns} turns; additional evidence is needed for high-confidence calibration.`
        : 'Candidate shows moderate but incomplete signal based on available report text; transcript evidence is unavailable.'),
    overallSignal: toSignalLabel(signalRaw),
    recommendationDecision: toDecisionLabel(decisionRaw),
    confidence: toConfidenceLabel(confidenceRaw),
    rationale: Array.isArray(structured.rationale)
      ? structured.rationale.map((x) => toText(x)).filter(Boolean).slice(0, 6)
      : [
          'Decision is based on available interview summary and score signals.',
          transcriptAvailable
            ? 'Transcript exists but curated excerpts are limited in this exported report.'
            : 'Transcript evidence unavailable; confidence is reduced.',
          'Role-relevant depth should be validated with targeted follow-up questions.',
        ],
    interviewScore: resolvedInterviewScore,
    rubricScore: resolvedRubricScore,
    scoreImplication:
      toText(structured.scoreImplication) ||
      (resolvedInterviewScore >= 80
        ? 'Scores indicate above-expectation readiness with good role alignment.'
        : resolvedInterviewScore >= 65
          ? 'Scores indicate moderate readiness with some unresolved risk.'
          : 'Scores indicate meaningful gaps versus expected role performance.'),
    calibrationNote:
      toText(structured.calibrationNote) || 'relative to expected level for Role (level unspecified).',
    competencies:
      structuredCompetencies.length > 0
        ? (structuredCompetencies as Competency[]).slice(0, 7)
        : buildDefaultCompetencies(resolvedInterviewScore, transcriptAvailable, toText(interview.jobTitle)),
    strengths: Array.isArray(structured.strengths)
      ? structured.strengths.map((x) => toText(x)).filter(Boolean).slice(0, 5)
      : [
          'Role-aligned technical exposure was identified in the interview summary.',
          'Candidate provided enough interaction to establish baseline competency signal.',
        ],
    risks: Array.isArray(structured.risks)
      ? structured.risks.map((x) => toText(x)).filter(Boolean).slice(0, 5)
      : [
          'Troubleshooting depth and edge-case handling remain unclear.',
          'Production reliability practices are not strongly evidenced.',
        ],
    followUpQuestions: Array.isArray(structured.followUpQuestions)
      ? structured.followUpQuestions.map((x) => toText(x)).filter(Boolean).slice(0, 6)
      : [
          'Walk through a production issue you debugged end-to-end and how you isolated root cause.',
          'Explain one architecture tradeoff you made and what metrics guided your decision.',
          'How do you validate reliability and security before production release?',
        ],
    nextStepsList: Array.isArray(structured.nextSteps)
      ? structured.nextSteps.map((x) => toText(x)).filter(Boolean).slice(0, 4)
      : [
          nextSteps || 'Run a focused technical follow-up on architecture, debugging depth, and reliability.',
          'Add a practical exercise aligned to core role requirements.',
        ].filter(Boolean),
    evidenceLimitations:
      toText(structured.evidenceLimitations) ||
      (transcriptAvailable
        ? `Transcript captured with ${candidateTurns} candidate turns. ${evidence || ''}`.trim()
        : 'No transcript excerpts available; evaluation is based on stored summary fields only.'),
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const kind = String(req.nextUrl.searchParams.get('kind') || '').trim();
    if (kind !== 'report' && kind !== 'transcript' && kind !== 'recording') {
      return NextResponse.json({ error: 'kind must be report, transcript, or recording' }, { status: 400 });
    }

    const interview = await getInterview(id);
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const baseName = cleanFilename(`${interview.candidateName || 'candidate'}_${interview.roomName || id}`);
    if (kind === 'transcript') {
      const transcript = String(interview.transcriptText || '').trim();
      if (!transcript) {
        return NextResponse.json({ error: 'Transcript not available yet' }, { status: 404 });
      }
      return new NextResponse(transcript, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}_transcript.txt"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (kind === 'recording') {
      const recordingUrl = String(interview.recordingUrl || '').trim();
      if (!recordingUrl) {
        return NextResponse.json({ error: 'Recording not available yet' }, { status: 404 });
      }
      let parsed: URL;
      try {
        parsed = new URL(recordingUrl);
      } catch {
        return NextResponse.json({ error: 'Recording URL is invalid' }, { status: 400 });
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return NextResponse.json({ error: 'Recording URL protocol is unsupported' }, { status: 400 });
      }
      return NextResponse.redirect(parsed.toString(), { status: 307 });
    }

    const assessment = buildDerivedAssessment(interview);
    const lines = [
      `## Interview Evaluation Report`,
      ``,
      `### 1) Header / Metadata`,
      `- **Interview ID:** \`${interview.id}\``,
      `- **Candidate:** \`${interview.candidateName || 'N/A'} (${interview.candidateEmail || 'N/A'})\``,
      `- **Interviewer:** \`${interview.interviewerName || 'N/A'} (${interview.interviewerEmail || 'N/A'})\``,
      `- **Role:** \`${interview.jobTitle || 'N/A'}\``,
      `- **Department:** \`${interview.jobDepartment || 'N/A'}\``,
      `- **Status:** \`${interview.status || 'N/A'}\``,
      `- **Scheduled / Actual Start / Actual End:** \`${interview.scheduledAt || 'N/A'}\` / \`${interview.meetingActualStart || 'N/A'}\` / \`${interview.meetingActualEnd || 'N/A'}\``,
      `- **Room:** \`${interview.roomName || 'N/A'}\``,
      `- **Agent Type:** \`${interview.agentType || 'classic'}\``,
      ``,
      `### 2) Executive Summary`,
      `${assessment.executiveSummary}`,
      `**Overall Signal:** **${assessment.overallSignal}**`,
      ``,
      `### 3) Recommendation`,
      `- **Recommendation:** **${assessment.recommendationDecision}**`,
      `- **Confidence:** **${assessment.confidence}**`,
      `- **Rationale:**`,
      ...assessment.rationale.map((r) => `- ${r}`),
      ``,
      `### 4) Scores`,
      `- **Interview Score (0-100):** \`${assessment.interviewScore}\``,
      `- **Rubric Score (0-10):** \`${assessment.rubricScore}\``,
      `- ${assessment.scoreImplication}`,
      `- Calibration note: ${assessment.calibrationNote}`,
      ``,
      `### 5) Competency Breakdown`,
      ...assessment.competencies.flatMap((c) => [
        `#### ${c.name} — **${c.score}/5**`,
        `- **Evidence:** ${c.evidence || 'Evidence: Not available (no transcript).'}`,
        `- **Strengths:**`,
        ...(c.strengths.length ? c.strengths.map((s) => `- ${s}`) : ['- Not enough evidence.']),
        `- **Concerns:**`,
        ...(c.concerns.length ? c.concerns.map((s) => `- ${s}`) : ['- Not enough evidence.']),
        ``,
      ]),
      `### 6) Strengths`,
      ...assessment.strengths.map((s) => `- ${s}`),
      ``,
      `### 7) Risks / Gaps`,
      ...assessment.risks.map((s) => `- ${s}`),
      ``,
      `### 8) Follow-up Questions`,
      ...assessment.followUpQuestions.map((q, i) => `${i + 1}. ${q}`),
      ``,
      `### 9) Next Steps`,
      ...assessment.nextStepsList.map((s) => `- ${s}`),
      ``,
      `### 10) Appendices`,
      `- **Recording URL:** ${interview.recordingUrl || 'N/A'}`,
      `- **Participants Joined:** ${interview.participantsJoined || 'N/A'}`,
      '',
      `Evidence limitations: ${assessment.evidenceLimitations}`,
    ];

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}_evaluation.txt"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate download';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
