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

function buildDerivedAssessment(interview: {
  summaryFeedback?: string;
  detailedFeedback?: string;
  recommendation?: string;
  interviewScore?: number;
  rubricScore?: number;
  nextSteps?: string;
  transcriptText?: string;
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
  const fallbackRecommendation =
    qualityScore >= 80 ? 'hire' : qualityScore >= 65 ? 'hold' : 'no_hire';
  const evidence = candidateLines
    .slice(0, 3)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, ''))
    .map((line) => `- ${line.slice(0, 180)}`)
    .join('\n');

  return {
    summaryFeedback:
      summaryFeedback ||
      (transcript
        ? `Assessment inferred from transcript: ${candidateTurns} candidate turns observed with moderate technical depth.`
        : 'Assessment not available yet.'),
    detailedFeedback:
      detailedFeedback ||
      (transcript
        ? [
            'Auto-generated from available transcript evidence.',
            'Observed communication and technical responses:',
            evidence || '- Limited transcript evidence captured.',
          ].join('\n')
        : 'Detailed feedback not available yet.'),
    recommendation: recommendation || fallbackRecommendation,
    interviewScore:
      typeof interview.interviewScore === 'number' && Number.isFinite(interview.interviewScore)
        ? clamp(Math.round(interview.interviewScore), 0, 100)
        : qualityScore,
    rubricScore:
      typeof interview.rubricScore === 'number' && Number.isFinite(interview.rubricScore)
        ? clamp(Number(interview.rubricScore), 0, 10)
        : Number((qualityScore / 10).toFixed(1)),
    nextSteps:
      nextSteps ||
      (transcript
        ? 'Run a focused follow-up on architecture tradeoffs, measurable impact, and role-specific depth.'
        : 'Schedule interview to collect sufficient evidence.'),
    source:
      summaryFeedback && detailedFeedback && recommendation
        ? 'stored_assessment'
        : transcript
          ? 'transcript_inferred'
          : 'minimal',
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const kind = String(req.nextUrl.searchParams.get('kind') || '').trim();
    if (kind !== 'report' && kind !== 'transcript') {
      return NextResponse.json({ error: 'kind must be report or transcript' }, { status: 400 });
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

    const assessment = buildDerivedAssessment(interview);
    const lines = [
      `Interview Evaluation Report`,
      `Interview ID: ${interview.id}`,
      `Candidate: ${interview.candidateName || 'N/A'} (${interview.candidateEmail || 'N/A'})`,
      `Interviewer: ${interview.interviewerName || 'N/A'} (${interview.interviewerEmail || 'N/A'})`,
      `Role: ${interview.jobTitle || 'N/A'} | Department: ${interview.jobDepartment || 'N/A'}`,
      `Status: ${interview.status || 'N/A'}`,
      `Scheduled: ${interview.scheduledAt || 'N/A'}`,
      `Actual Start: ${interview.meetingActualStart || 'N/A'}`,
      `Actual End: ${interview.meetingActualEnd || 'N/A'}`,
      `Room: ${interview.roomName || 'N/A'}`,
      `Agent Type: ${interview.agentType || 'classic'}`,
      '',
      `Scores`,
      `- Interview Score (0-100): ${assessment.interviewScore}`,
      `- Rubric Score (0-10): ${assessment.rubricScore}`,
      `- Recommendation: ${assessment.recommendation || 'N/A'}`,
      `- Report Source: ${assessment.source}`,
      '',
      `Summary`,
      assessment.summaryFeedback,
      '',
      `Detailed Feedback`,
      assessment.detailedFeedback,
      '',
      `Next Steps`,
      assessment.nextSteps,
      '',
      `Recording URL`,
      interview.recordingUrl || 'N/A',
      '',
      `Participants Joined`,
      interview.participantsJoined || 'N/A',
    ];

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}_evaluation.txt"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate download';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
