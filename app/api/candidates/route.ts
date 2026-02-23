import { computeCvJdDetailedScorecard, computeCvJdScorecard } from '@/lib/server/cvJdScoring';
import { attachCandidateCv, createCandidateApplication, listCandidateApplications } from '@/lib/server/candidateStore';
import { extractCandidateContextFromUpload, buildRoleContextFromPosition } from '@/lib/server/cvContext';
import { getPosition } from '@/lib/server/positionStore';
import { NextRequest, NextResponse } from 'next/server';

function readRequiredText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value.trim();
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  if (typeof File !== 'undefined') return value instanceof File;
  return typeof (value as File).arrayBuffer === 'function' && typeof (value as File).size === 'number';
}

function recommendationFromScore(scorecard: ReturnType<typeof computeCvJdScorecard>): 'strong_fit' | 'fit' | 'borderline' | 'reject' {
  if (!scorecard) return 'reject';
  const mustRatio = scorecard.mustHaveTotal > 0 ? scorecard.mustHaveMatched / scorecard.mustHaveTotal : 0;
  if (mustRatio < 0.5) return 'reject';
  if (scorecard.overallScore >= 80) return 'strong_fit';
  if (scorecard.overallScore >= 65) return 'fit';
  if (scorecard.overallScore >= 50) return 'borderline';
  return 'reject';
}

function conclusionForRecommendation(
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject',
  scorecard: ReturnType<typeof computeCvJdScorecard>,
): string {
  if (!scorecard) return 'Insufficient CV evidence for role requirements.';
  const base = `Overall ${scorecard.overallScore}/100 with ${scorecard.mustHaveMatched}/${scorecard.mustHaveTotal} must-have matches.`;
  if (recommendation === 'strong_fit') return `${base} Strong shortlist recommendation.`;
  if (recommendation === 'fit') return `${base} Suitable for shortlist.`;
  if (recommendation === 'borderline') return `${base} Borderline fit; shortlist only if pipeline is light.`;
  return `${base} Not recommended for shortlist.`;
}

export async function GET(req: NextRequest) {
  try {
    const positionId = req.nextUrl.searchParams.get('positionId') || undefined;
    const candidates = await listCandidateApplications(positionId);
    return NextResponse.json({ ok: true, candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load candidates';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const positionId = readRequiredText(form, 'positionId');
    const candidateName = readRequiredText(form, 'candidateName');
    const candidateEmail = readRequiredText(form, 'candidateEmail');
    const cvFile = form.get('cv');
    if (!isUploadedFile(cvFile) || cvFile.size <= 0) {
      return NextResponse.json({ ok: false, error: 'CV file is required.' }, { status: 400 });
    }

    const position = await getPosition(positionId);
    if (!position) {
      return NextResponse.json({ ok: false, error: 'Position not found.' }, { status: 404 });
    }

    const positionSnapshot = {
      role_title: position.role_title,
      level: position.level,
      duration_minutes: position.duration_minutes,
      must_haves: position.must_haves,
      nice_to_haves: position.nice_to_haves,
      tech_stack: position.tech_stack,
      focus_areas: position.focus_areas,
      deep_dive_mode: position.deep_dive_mode,
      strictness: position.strictness,
      evaluation_policy: position.evaluation_policy,
      notes_for_interviewer: position.notes_for_interviewer,
    };

    const candidateContext = await extractCandidateContextFromUpload(cvFile).catch(() => '');
    const roleContext = buildRoleContextFromPosition(positionSnapshot, position.role_title, '');
    const cvJdScorecard = computeCvJdScorecard({ candidateContext, roleContext, positionSnapshot });
    const detailedScorecard = computeCvJdDetailedScorecard({
      candidateContext,
      mustHaves: position.must_haves,
      niceToHaves: position.nice_to_haves,
      techStack: position.tech_stack,
      focusAreas: position.focus_areas,
    });
    const recommendation = recommendationFromScore(cvJdScorecard);
    const conclusion = conclusionForRecommendation(recommendation, cvJdScorecard);

    let created = await createCandidateApplication({
      positionId,
      candidateName,
      candidateEmail,
      candidateContext,
      roleContext,
      cvJdScorecard,
      detailedScorecard,
      recommendation,
      conclusion,
    });
    created = await attachCandidateCv(created.id, cvFile);

    return NextResponse.json({ ok: true, candidate: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create candidate application';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
