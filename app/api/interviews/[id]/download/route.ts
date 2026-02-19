import { getInterview } from '@/lib/server/interviewStore';
import { NextRequest, NextResponse } from 'next/server';

function cleanFilename(input: string): string {
  return String(input || 'interview')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'interview';
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
      `- Interview Score (0-100): ${interview.interviewScore ?? 'N/A'}`,
      `- Rubric Score (0-10): ${interview.rubricScore ?? 'N/A'}`,
      `- Recommendation: ${interview.recommendation || 'N/A'}`,
      '',
      `Summary`,
      interview.summaryFeedback || 'N/A',
      '',
      `Detailed Feedback`,
      interview.detailedFeedback || 'N/A',
      '',
      `Next Steps`,
      interview.nextSteps || 'N/A',
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
