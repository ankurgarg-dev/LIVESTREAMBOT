'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import styles from './page.module.css';

type PositionRecord = {
  position_id: string;
  role_title: string;
  level: string;
};

type DetailedSkill = {
  skill: string;
  category: 'must_have' | 'nice_to_have' | 'tech_stack' | 'focus_area';
  matched: boolean;
  score: number;
  oneLiner: string;
};

type CandidateApplication = {
  id: string;
  positionId: string;
  candidateName: string;
  candidateEmail: string;
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  createdAt: string;
  cvJdScorecard?: {
    overallScore: number;
    mustHaveScore: number;
    commonSkillScore: number;
    summary: string;
  };
  detailedScorecard?: {
    overallScore: number;
    summary: string;
    details: DetailedSkill[];
  };
};

const CATEGORY_LABEL: Record<DetailedSkill['category'], string> = {
  must_have: 'Must Have',
  nice_to_have: 'Nice to Have',
  tech_stack: 'Tech Stack',
  focus_area: 'Focus Area',
};

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatRecommendation(value: CandidateApplication['recommendation']): string {
  if (value === 'strong_fit') return 'Strong Fit';
  if (value === 'fit') return 'Fit';
  if (value === 'borderline') return 'Borderline';
  return 'Reject';
}

function pct(value: number | undefined): number {
  const n = Number(value || 0);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

export default function CandidatesPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [positions, setPositions] = React.useState<PositionRecord[]>([]);
  const [selectedPositionId, setSelectedPositionId] = React.useState('');
  const [applications, setApplications] = React.useState<CandidateApplication[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [initialPositionId, setInitialPositionId] = React.useState('');

  const [candidateName, setCandidateName] = React.useState('');
  const [candidateEmail, setCandidateEmail] = React.useState('');

  const selected = React.useMemo(
    () => applications.find((item) => item.id === selectedId),
    [applications, selectedId],
  );

  const loadPositions = React.useCallback(async () => {
    const response = await fetch('/api/positions', { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to load positions');
    return Array.isArray(json?.positions) ? json.positions : [];
  }, []);

  const loadApplications = React.useCallback(async (positionId: string) => {
    if (!positionId) {
      setApplications([]);
      return;
    }
    const response = await fetch(`/api/candidates?positionId=${encodeURIComponent(positionId)}`, { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to load applications');
    setApplications(Array.isArray(json?.candidates) ? json.candidates : []);
  }, []);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await loadPositions();
      setPositions(loaded);
      const fromQuery = String(initialPositionId || '').trim();
      const fallback = loaded[0]?.position_id || '';
      const chosen = loaded.some((p: PositionRecord) => p.position_id === fromQuery) ? fromQuery : fallback;
      setSelectedPositionId(chosen);
      await loadApplications(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates module');
    } finally {
      setLoading(false);
    }
  }, [initialPositionId, loadApplications, loadPositions]);

  React.useEffect(() => {
    const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    setInitialPositionId(String(query.get('positionId') || '').trim());
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (!selectedPositionId) return;
    setSelectedId('');
    void loadApplications(selectedPositionId);
  }, [loadApplications, selectedPositionId]);

  const submitApplication: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const cvInput = document.getElementById('candidateCvUpload') as HTMLInputElement | null;
      const cvFile = cvInput?.files?.[0];
      if (!cvFile) throw new Error('Please select a CV file.');
      if (!selectedPositionId) throw new Error('Please select a position.');

      const form = new FormData();
      form.set('positionId', selectedPositionId);
      form.set('candidateName', candidateName);
      form.set('candidateEmail', candidateEmail);
      form.set('cv', cvFile);

      const response = await fetch('/api/candidates', { method: 'POST', body: form });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to submit candidate');

      setCandidateName('');
      setCandidateEmail('');
      if (cvInput) cvInput.value = '';
      setSuccess('Candidate application submitted and scored.');
      await loadApplications(selectedPositionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit candidate');
    } finally {
      setSaving(false);
    }
  };

  const prefillCandidateFromCv = async (file: File | null) => {
    if (!file) return;
    try {
      const form = new FormData();
      form.set('cv', file);
      const response = await fetch('/api/candidates/prefill', { method: 'POST', body: form });
      const json = await response.json();
      if (!response.ok || json?.ok === false) return;
      if (json?.candidateName) setCandidateName(String(json.candidateName));
      if (json?.candidateEmail) setCandidateEmail(String(json.candidateEmail));
    } catch {
      // Keep manual entry path on prefill errors.
    }
  };

  const detailsByCategory = React.useMemo(() => {
    const rows = selected?.detailedScorecard?.details || [];
    return {
      must_have: rows.filter((x) => x.category === 'must_have'),
      nice_to_have: rows.filter((x) => x.category === 'nice_to_have'),
      tech_stack: rows.filter((x) => x.category === 'tech_stack'),
      focus_area: rows.filter((x) => x.category === 'focus_area'),
    };
  }, [selected]);

  return (
    <main className={styles.main}>
      <div className={styles.row}>
        <h2 style={{ margin: 0 }}>Candidates Module</h2>
        <button type="button" className="lk-button" onClick={() => router.push('/?tab=positions')}>
          Back to Positions
        </button>
      </div>

      {error ? <p className={styles.warn}>{error}</p> : null}
      {success ? <p className={styles.ok}>{success}</p> : null}
      {loading ? <p>Loading...</p> : null}

      {!loading ? (
        <>
          <section className={styles.panel}>
            <h3 style={{ margin: 0 }}>Submit CV Against Position</h3>
            <div className={styles.row}>
              <label>Position</label>
              <select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)}>
                {positions.map((position) => (
                  <option key={position.position_id} value={position.position_id}>
                    {position.role_title} ({position.level})
                  </option>
                ))}
              </select>
            </div>
            <form onSubmit={submitApplication} className={styles.grid3}>
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Candidate Name (auto from CV, editable)"
              />
              <input
                value={candidateEmail}
                onChange={(e) => setCandidateEmail(e.target.value)}
                placeholder="Candidate Email (auto from CV, editable)"
                type="email"
              />
              <input
                id="candidateCvUpload"
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                required
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  void prefillCandidateFromCv(file);
                }}
              />
              <div className={styles.row}>
                <button type="submit" className="lk-button" disabled={saving}>
                  {saving ? 'Scoring...' : 'Submit CV'}
                </button>
              </div>
            </form>
          </section>

          <section className={styles.panel}>
            <h3 style={{ margin: 0 }}>Applications</h3>
            {applications.length === 0 ? <p className={styles.meta}>No CV applications yet for this position.</p> : null}
            {applications.map((item) => (
              <div key={item.id} className={styles.card}>
                <div className={styles.row}>
                  <strong>{item.candidateName}</strong>
                  <span className={styles.badge}>{formatRecommendation(item.recommendation)}</span>
                </div>
                <div className={styles.meta}>{item.candidateEmail}</div>
                <div className={styles.row}>
                  <span className={styles.score}>{`Relevance: ${pct(item.cvJdScorecard?.overallScore)}/100`}</span>
                  <span className={styles.meta}>{formatDate(item.createdAt)}</span>
                </div>
                <p className={styles.meta}>{item.cvJdScorecard?.summary || item.conclusion}</p>
                <div className={styles.row}>
                  <button type="button" className="lk-button" onClick={() => setSelectedId(item.id)}>
                    View Details
                  </button>
                  <a className="lk-button" href={`/api/candidates/${encodeURIComponent(item.id)}/asset`}>
                    Download CV
                  </a>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {selected ? (
        <div className={styles.overlay} role="presentation" onClick={() => setSelectedId('')}>
          <div className={styles.dialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.row}>
              <h3 style={{ margin: 0 }}>{`CV Match Details: ${selected.candidateName}`}</h3>
              <button type="button" className="lk-button" onClick={() => setSelectedId('')}>
                Close
              </button>
            </div>
            <p className={styles.meta}><strong>Recommendation:</strong> {formatRecommendation(selected.recommendation)}</p>
            <p className={styles.meta}><strong>Conclusion:</strong> {selected.conclusion}</p>

            <div className={styles.grid3}>
              <div className={styles.barWrap}>
                <span>Overall</span>
                <div className={styles.bar}><div className={styles.barFill} style={{ width: `${pct(selected.cvJdScorecard?.overallScore)}%` }} /></div>
                <span className={styles.score}>{`${pct(selected.cvJdScorecard?.overallScore)}/100`}</span>
              </div>
              <div className={styles.barWrap}>
                <span>Must Have</span>
                <div className={styles.bar}><div className={styles.barFill} style={{ width: `${pct(selected.cvJdScorecard?.mustHaveScore)}%` }} /></div>
                <span className={styles.score}>{`${pct(selected.cvJdScorecard?.mustHaveScore)}/100`}</span>
              </div>
              <div className={styles.barWrap}>
                <span>Common</span>
                <div className={styles.bar}><div className={styles.barFill} style={{ width: `${pct(selected.cvJdScorecard?.commonSkillScore)}%` }} /></div>
                <span className={styles.score}>{`${pct(selected.cvJdScorecard?.commonSkillScore)}/100`}</span>
              </div>
            </div>

            {(Object.keys(detailsByCategory) as Array<keyof typeof detailsByCategory>).map((key) => (
              <div key={key}>
                <h4 style={{ marginBottom: 6 }}>{CATEGORY_LABEL[key]}</h4>
                {detailsByCategory[key].length === 0 ? (
                  <p className={styles.meta}>No competencies in this category.</p>
                ) : (
                  <div className={styles.table}>
                    {detailsByCategory[key].map((row) => (
                      <div key={`${key}:${row.skill}`} className={styles.rowItem}>
                        <span><strong>{row.skill}</strong></span>
                        <span>{row.matched ? `${row.score}` : '0'}</span>
                        <span className={styles.meta}>{row.oneLiner}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}
