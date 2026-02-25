'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import styles from './page.module.css';

type PositionRecord = {
  position_id: string;
  role_title: string;
  level: string;
};

export default function CandidatesPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [positions, setPositions] = React.useState<PositionRecord[]>([]);
  const [selectedPositionId, setSelectedPositionId] = React.useState('');
  const [initialPositionId, setInitialPositionId] = React.useState('');

  const [candidateName, setCandidateName] = React.useState('');
  const [candidateEmail, setCandidateEmail] = React.useState('');
  const [currentTitle, setCurrentTitle] = React.useState('');
  const [yearsExperience, setYearsExperience] = React.useState('');
  const [keySkills, setKeySkills] = React.useState('');
  const [candidateContext, setCandidateContext] = React.useState('');

  const loadPositions = React.useCallback(async () => {
    const response = await fetch('/api/positions', { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to load positions');
    return Array.isArray(json?.positions) ? json.positions : [];
  }, []);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await loadPositions();
      setPositions(loaded);
      const fromQuery = String(initialPositionId || '').trim();
      const chosen = loaded.some((p: PositionRecord) => p.position_id === fromQuery) ? fromQuery : '';
      setSelectedPositionId(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates module');
    } finally {
      setLoading(false);
    }
  }, [initialPositionId, loadPositions]);

  React.useEffect(() => {
    const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    setInitialPositionId(String(query.get('positionId') || '').trim());
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const submitApplication: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const cvInput = document.getElementById('candidateCvUpload') as HTMLInputElement | null;
      const cvFile = cvInput?.files?.[0];
      if (!cvFile) throw new Error('Please select a CV file.');

      const form = new FormData();
      if (selectedPositionId) form.set('positionId', selectedPositionId);
      form.set('candidateName', candidateName);
      form.set('candidateEmail', candidateEmail);
      form.set('currentTitle', currentTitle);
      form.set('yearsExperience', yearsExperience);
      form.set('keySkills', keySkills);
      form.set('candidateContext', candidateContext);
      form.set('cv', cvFile);

      const response = await fetch('/api/candidates', { method: 'POST', body: form });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Failed to submit candidate');

      setCandidateName('');
      setCandidateEmail('');
      setCurrentTitle('');
      setYearsExperience('');
      setKeySkills('');
      setCandidateContext('');
      if (cvInput) cvInput.value = '';
      if (json?.openCandidate) {
        setSuccess('Candidate profile saved as open (not applied to any position yet).');
      } else {
        const createdCount = Number(json?.createdCount || 1);
        setSuccess(
          createdCount > 1
            ? `Candidate submitted and screened across ${createdCount} positions.`
            : 'Candidate application submitted and scored.',
        );
      }
      await loadData();
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
      if (json?.currentTitle) setCurrentTitle(String(json.currentTitle));
      if (json?.yearsExperience) setYearsExperience(String(json.yearsExperience));
      if (Array.isArray(json?.keySkills)) setKeySkills(json.keySkills.map(String).join(', '));
      if (json?.candidateContext) setCandidateContext(String(json.candidateContext));
    } catch {
      // Keep manual entry path on prefill errors.
    }
  };

  return (
    <main className={styles.main} data-lk-theme="default">
      <div className={styles.row}>
        <h2 style={{ margin: 0 }}>Candidates</h2>
        <button type="button" className="lk-button" onClick={() => router.push('/?tab=dashboard')}>
          Back to Dashboard
        </button>
      </div>

      {error ? <p className={styles.warn}>{error}</p> : null}
      {success ? <p className={styles.ok}>{success}</p> : null}
      {loading ? <p>Loading...</p> : null}

      {!loading ? (
        <>
          <section className={styles.panel}>
            <h3 style={{ margin: 0 }}>Submit CV (Position Optional)</h3>
            <div className={styles.row}>
              <label>Position</label>
              <select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)}>
                <option value="">All Positions</option>
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
                value={currentTitle}
                onChange={(e) => setCurrentTitle(e.target.value)}
                placeholder="Current Title (auto from CV, editable)"
              />
              <input
                value={yearsExperience}
                onChange={(e) => setYearsExperience(e.target.value)}
                placeholder="Experience (auto from CV, editable)"
              />
              <input
                value={keySkills}
                onChange={(e) => setKeySkills(e.target.value)}
                placeholder="Key Skills (comma separated, editable)"
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
              <textarea
                rows={5}
                value={candidateContext}
                onChange={(e) => setCandidateContext(e.target.value)}
                placeholder="Candidate profile summary/context (auto from CV, editable)"
              />
            </form>
          </section>

          <section className={styles.panel}>
            <h3 style={{ margin: 0 }}>Candidate Creation</h3>
            <p className={styles.meta}>Open candidates are shown on Dashboard → Candidates.</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
