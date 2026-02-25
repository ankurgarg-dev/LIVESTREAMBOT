import { computeCvJdDetailedScorecard, computeCvJdScorecard } from '@/lib/server/cvJdScoring';
import { canonicalizeSkillList } from '@/lib/server/skillCanonicalization';
import { buildRoleContextFromPosition } from '@/lib/server/cvContext';
import { generateAiScreening, type AiScreeningResult } from '@/lib/server/aiScreening';
import {
  createCandidateApplication,
  getCandidate,
  getStoredCandidateScreening,
  setStoredCandidateScreening,
} from '@/lib/server/candidateStore';
import { getPosition } from '@/lib/server/positionStore';
import { NextRequest, NextResponse } from 'next/server';

type ApplyAction = 'screen' | 'create' | 'get';

function toCanonicalNames(items: Array<{ canonical_name: string | null; raw_text: string }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = String(item.canonical_name || item.raw_text || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
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

function blendedRecommendationFromScore(score: number): 'strong_fit' | 'fit' | 'borderline' | 'reject' {
  if (score >= 80) return 'strong_fit';
  if (score >= 65) return 'fit';
  if (score >= 50) return 'borderline';
  return 'reject';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      candidateId?: string;
      positionId?: string;
      action?: ApplyAction;
    };
    const candidateId = String(body?.candidateId || '').trim();
    const positionId = String(body?.positionId || '').trim();
    const action = String(body?.action || '').trim().toLowerCase() as ApplyAction;
    if (!candidateId || !positionId) {
      return NextResponse.json({ ok: false, error: 'candidateId and positionId are required.' }, { status: 400 });
    }
    if (action !== 'screen' && action !== 'create' && action !== 'get') {
      return NextResponse.json({ ok: false, error: 'Invalid action. Use get, screen or create.' }, { status: 400 });
    }

    const [candidate, position] = await Promise.all([getCandidate(candidateId), getPosition(positionId)]);
    if (!candidate) return NextResponse.json({ ok: false, error: 'Candidate not found.' }, { status: 404 });
    if (!position) return NextResponse.json({ ok: false, error: 'Position not found.' }, { status: 404 });

    const [mustCanonical, niceCanonical, techCanonical] = await Promise.all([
      canonicalizeSkillList(position.must_haves, null),
      canonicalizeSkillList(position.nice_to_haves, null),
      canonicalizeSkillList(position.tech_stack, null),
    ]);

    const positionSnapshot = {
      role_title: position.role_title,
      level: position.level,
      duration_minutes: position.duration_minutes,
      must_haves: toCanonicalNames(mustCanonical),
      nice_to_haves: toCanonicalNames(niceCanonical),
      tech_stack: toCanonicalNames(techCanonical),
      focus_areas: position.focus_areas,
      deep_dive_mode: position.deep_dive_mode,
      strictness: position.strictness,
      evaluation_policy: position.evaluation_policy,
      notes_for_interviewer: position.notes_for_interviewer,
    };
    const candidateContext = String(candidate.candidateContext || '').trim();
    const roleContext = buildRoleContextFromPosition(positionSnapshot, position.role_title, '');

    if (action === 'get') {
      const stored = await getStoredCandidateScreening(candidateId, positionId);
      if (!stored) {
        return NextResponse.json(
          { ok: false, error: 'No stored screening found. Click Screen first.' },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        screening: {
          candidateId,
          positionId,
          recommendation: stored.deterministicRecommendation,
          conclusion: stored.conclusion,
          cvJdScorecard: stored.cvJdScorecard,
          detailedScorecard: stored.detailedScorecard,
          aiScreening: stored.aiScreening,
          blendedScore: stored.blendedScore,
          blendedRecommendation: stored.blendedRecommendation,
          updatedAt: stored.updatedAt,
        },
      });
    }

    if (action === 'screen') {
      const cvJdScorecard = computeCvJdScorecard({
        candidateContext,
        candidateSkills: candidate.keySkills || [],
        roleContext,
        positionSnapshot,
      });
      const detailedScorecard = computeCvJdDetailedScorecard({
        candidateContext,
        mustHaves: position.must_haves,
        niceToHaves: position.nice_to_haves,
        techStack: position.tech_stack,
        focusAreas: position.focus_areas,
      });
      const deterministicRecommendation = recommendationFromScore(cvJdScorecard);
      const conclusion = conclusionForRecommendation(deterministicRecommendation, cvJdScorecard);
      let aiScreening: AiScreeningResult | undefined;
      try {
        aiScreening = await generateAiScreening({
          roleTitle: position.role_title,
          jdText: String(position.jd_text || roleContext || '').trim(),
          cvText: String(candidateContext || '').trim(),
        });
      } catch {
        aiScreening = undefined;
      }
      const deterministicScore = Number(cvJdScorecard?.overallScore || 0);
      const blendedScore = Math.round(
        aiScreening ? deterministicScore * 0.5 + Number(aiScreening.score || 0) * 0.5 : deterministicScore,
      );
      const blendedRecommendation = blendedRecommendationFromScore(blendedScore);
      const stored = await setStoredCandidateScreening(candidateId, positionId, {
        deterministicRecommendation,
        conclusion,
        cvJdScorecard,
        detailedScorecard,
        aiScreening,
        blendedScore,
        blendedRecommendation,
      });

      return NextResponse.json({
        ok: true,
        screening: {
          candidateId,
          positionId,
          recommendation: stored.deterministicRecommendation,
          conclusion: stored.conclusion,
          cvJdScorecard: stored.cvJdScorecard,
          detailedScorecard: stored.detailedScorecard,
          aiScreening: stored.aiScreening,
          blendedScore: stored.blendedScore,
          blendedRecommendation: stored.blendedRecommendation,
          updatedAt: stored.updatedAt,
        },
      });
    }

    const stored = await getStoredCandidateScreening(candidateId, positionId);
    if (!stored) {
      return NextResponse.json(
        { ok: false, error: 'No stored screening found. Click Screen first.' },
        { status: 400 },
      );
    }
    const created = await createCandidateApplication({
      positionId: position.position_id,
      candidateId: candidate.id,
      candidateName: candidate.fullName,
      candidateEmail: candidate.email,
      candidateContext,
      roleContext,
      cvJdScorecard: stored.cvJdScorecard,
      detailedScorecard: stored.detailedScorecard,
      canonicalSkills: {
        must_haves: mustCanonical,
        nice_to_haves: niceCanonical,
        tech_stack: techCanonical,
      },
      recommendation: stored.blendedRecommendation,
      conclusion: `${stored.conclusion} Blended score ${stored.blendedScore}/100.`,
      aiScreening: stored.aiScreening,
      blendedScore: stored.blendedScore,
      blendedRecommendation: stored.blendedRecommendation,
    });
    return NextResponse.json({ ok: true, candidate: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process application action';
    if (/already applied|unique constraint|P2002/i.test(message)) {
      return NextResponse.json({ ok: false, error: 'Candidate is already applied to this position.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
