'use client';

import { useRouter } from 'next/navigation';
import React from 'react';

type SkillRow = {
  skill: string;
  category: 'must_have' | 'common';
  matched: boolean;
  matchType: 'exact' | 'partial' | 'none';
  score: number;
  oneLiner: string;
};

type ScreeningPayload = {
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  blendedScore?: number;
  blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  updatedAt?: string;
  aiScreening?: {
    score: number;
    summary: string;
    strengths: string[];
    gaps: string[];
    reasoning: string[];
    model: string;
  };
  cvJdScorecard?: {
    overallScore: number;
    mustHaveScore: number;
    commonSkillScore: number;
    mustHaveMatched: number;
    mustHaveTotal: number;
    commonMatched: number;
    commonTotal: number;
    summary: string;
    details: SkillRow[];
  };
};

type Props = {
  candidateId: string;
  positionId: string;
};

export default function CandidateScreeningClient({ candidateId, positionId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [screening, setScreening] = React.useState<ScreeningPayload | null>(null);

  React.useEffect(() => {
    const run = async () => {
      if (!candidateId || !positionId) {
        setError('Missing candidateId or positionId.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/candidates/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get', candidateId, positionId }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok || !json?.screening) {
          throw new Error(json?.error || 'Failed to load stored screening details');
        }
        setScreening(json.screening as ScreeningPayload);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load stored screening details');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [candidateId, positionId]);

  return (
    <main data-lk-theme="default" style={{ maxWidth: 1100, margin: '1rem auto', padding: '0 1rem 1.5rem', display: 'grid', gap: '0.8rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Candidate Screening Details</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="lk-button" onClick={() => router.push('/?tab=candidates')}>
            Back to Candidates
          </button>
          <button type="button" className="lk-button" onClick={() => window.close()}>
            Close Window
          </button>
        </div>
      </div>

      {loading ? <p>Loading screening details...</p> : null}
      {error ? <p style={{ color: '#b63f4a', margin: 0 }}>{error}</p> : null}

      {!loading && !error && screening ? (
        <section style={{ border: '1px solid #d0e0e8', borderRadius: 12, background: '#f8fcfe', padding: '0.9rem', display: 'grid', gap: '0.8rem' }}>
          <section style={{ border: '1px solid #d0e0e8', borderRadius: 10, background: '#fff', padding: '0.75rem', display: 'grid', gap: '0.35rem' }}>
            <h3 style={{ margin: 0 }}>Blended Screening</h3>
            <p style={{ margin: 0 }}>
              {`Recommendation: ${
                screening.blendedRecommendation?.toUpperCase() || 'N/A'
              } | Score ${screening.blendedScore ?? 0}/100`}
            </p>
            {screening.updatedAt ? (
              <p style={{ margin: 0, color: '#405b6c', fontSize: '0.88rem' }}>{`Last screened: ${new Date(screening.updatedAt).toLocaleString()}`}</p>
            ) : null}
          </section>

          <section style={{ border: '1px solid #d0e0e8', borderRadius: 10, background: '#fff', padding: '0.75rem', display: 'grid', gap: '0.4rem' }}>
            <h3 style={{ margin: 0 }}>AI Screening</h3>
            {screening.aiScreening ? (
              <>
                <p style={{ margin: 0 }}>{`Score: ${screening.aiScreening.score}/100`}</p>
                <p style={{ margin: 0 }}>{screening.aiScreening.summary}</p>
                {screening.aiScreening.strengths.length > 0 ? (
                  <p style={{ margin: 0 }}>{`Strengths: ${screening.aiScreening.strengths.join(' | ')}`}</p>
                ) : null}
                {screening.aiScreening.gaps.length > 0 ? (
                  <p style={{ margin: 0 }}>{`Gaps: ${screening.aiScreening.gaps.join(' | ')}`}</p>
                ) : null}
                {screening.aiScreening.reasoning.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.2rem' }}>
                    {screening.aiScreening.reasoning.map((line, idx) => (
                      <p key={`ai-reason-${idx}`} style={{ margin: 0, color: '#405b6c', fontSize: '0.9rem' }}>
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p style={{ margin: 0, color: '#405b6c' }}>AI screening unavailable for this request.</p>
            )}
          </section>

          <section style={{ border: '1px solid #d0e0e8', borderRadius: 10, background: '#fff', padding: '0.75rem', display: 'grid', gap: '0.4rem' }}>
            <h3 style={{ margin: 0 }}>Deterministic Screening</h3>
            <p style={{ margin: 0 }}>{`Recommendation: ${screening.recommendation.toUpperCase()}`}</p>
            <p style={{ margin: 0 }}>{screening.conclusion}</p>
            <p style={{ margin: 0 }}>
              {`Overall: ${screening.cvJdScorecard?.overallScore ?? 0}/100 | Must-have: ${
                screening.cvJdScorecard?.mustHaveScore ?? 0
              } (${screening.cvJdScorecard?.mustHaveMatched ?? 0}/${screening.cvJdScorecard?.mustHaveTotal ?? 0}) | Common: ${
                screening.cvJdScorecard?.commonSkillScore ?? 0
              } (${screening.cvJdScorecard?.commonMatched ?? 0}/${screening.cvJdScorecard?.commonTotal ?? 0})`}
            </p>
            <p style={{ margin: 0 }}>
              Derivation rule: overall uses 75% must-have score + 25% common score when must-haves exist; otherwise 100% common.
            </p>
            <p style={{ margin: 0 }}>{screening.cvJdScorecard?.summary || ''}</p>

            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {(screening.cvJdScorecard?.details || []).map((row) => (
                <div
                  key={`${row.category}:${row.skill}`}
                  style={{ border: '1px solid #d0e0e8', borderRadius: 10, background: '#fff', padding: '0.55rem 0.65rem', display: 'grid', gap: '0.25rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                    <strong>{row.skill}</strong>
                    <span>{row.matched ? `Matched (${row.matchType})` : 'Not matched'}</span>
                  </div>
                  <div style={{ color: '#405b6c', fontSize: '0.88rem' }}>{`Category: ${row.category} | Score: ${row.score}`}</div>
                  <div style={{ color: '#405b6c', fontSize: '0.88rem' }}>{row.oneLiner}</div>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  );
}
