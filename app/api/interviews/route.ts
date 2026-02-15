import {
  attachInterviewAsset,
  createInterview,
  listInterviews,
  type InterviewCreateInput,
} from '@/lib/server/interviewStore';
import { NextRequest, NextResponse } from 'next/server';

function readRequiredText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value.trim();
}

export async function GET() {
  try {
    const interviews = await listInterviews();
    return NextResponse.json({ ok: true, interviews });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load interviews';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const durationRaw = readRequiredText(form, 'durationMinutes');
    const duration = Number(durationRaw);
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: 'durationMinutes must be a positive number' }, { status: 400 });
    }

    const input: InterviewCreateInput = {
      roomName: readRequiredText(form, 'roomName'),
      candidateName: readRequiredText(form, 'candidateName'),
      candidateEmail: readRequiredText(form, 'candidateEmail'),
      interviewerName: readRequiredText(form, 'interviewerName'),
      interviewerEmail: String(form.get('interviewerEmail') ?? '').trim(),
      jobTitle: readRequiredText(form, 'jobTitle'),
      jobDepartment: String(form.get('jobDepartment') ?? '').trim(),
      scheduledAt: readRequiredText(form, 'scheduledAt'),
      durationMinutes: duration,
      timezone: String(form.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone).trim(),
      notes: String(form.get('notes') ?? '').trim(),
    };

    let interview = await createInterview(input);
    const cvFile = form.get('cv');
    const jdFile = form.get('jd');

    if (cvFile instanceof File && cvFile.size > 0) {
      interview = await attachInterviewAsset(interview.id, 'cv', cvFile);
    }
    if (jdFile instanceof File && jdFile.size > 0) {
      interview = await attachInterviewAsset(interview.id, 'jd', jdFile);
    }

    return NextResponse.json({ ok: true, interview }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create interview';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
