import { extractCandidateProfileFromUpload } from '@/lib/server/cvContext';
import { NextRequest, NextResponse } from 'next/server';

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  if (typeof File !== 'undefined') return value instanceof File;
  return typeof (value as File).arrayBuffer === 'function' && typeof (value as File).size === 'number';
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const cvFile = form.get('cv');
    if (!isUploadedFile(cvFile) || cvFile.size <= 0) {
      return NextResponse.json({ ok: false, error: 'CV file is required.' }, { status: 400 });
    }
    const profile = await extractCandidateProfileFromUpload(cvFile);
    return NextResponse.json({
      ok: true,
      candidateName: profile.candidateName,
      candidateEmail: profile.candidateEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prefill candidate details from CV';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
