'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ARCHETYPES,
  DEEP_DIVE_MODES,
  DURATIONS,
  EVALUATION_POLICIES,
  FOCUS_AREAS,
  INTERVIEW_ROUND_TYPES,
  LEVELS,
  ROLE_FAMILIES,
  STRICTNESS_LEVELS,
  type PositionConfigCore,
} from '@/lib/position/types';
import styles from '../styles/Home.module.css';

type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | '';
type AgentType = 'classic' | 'realtime_screening';
type MainTab = 'dashboard' | 'positions' | 'interviews';
type PositionDetailsTab = 'job' | 'plan' | 'candidates' | 'interviews';

type InterviewAssetMeta = {
  originalName: string;
  storedName: string;
  contentType: string;
  size: number;
};

type InterviewRecord = {
  id: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  roomName: string;
  candidateName: string;
  candidateEmail: string;
  interviewerName: string;
  interviewerEmail: string;
  jobTitle: string;
  jobDepartment: string;
  scheduledAt: string;
  durationMinutes: number;
  timezone: string;
  notes: string;
  agentType: AgentType;
  positionId?: string;
  positionSnapshot?: PositionConfigCore;
  cv?: InterviewAssetMeta;
  jd?: InterviewAssetMeta;
  meetingActualStart?: string;
  meetingActualEnd?: string;
  participantsJoined?: string;
  recordingUrl?: string;
  rubricScore?: number;
  interviewScore?: number;
  recommendation?: Recommendation;
  summaryFeedback?: string;
  detailedFeedback?: string;
  nextSteps?: string;
  createdAt: string;
  updatedAt: string;
};

type PositionRecord = PositionConfigCore & {
  position_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type SetupFormState = {
  candidateName: string;
  candidateEmail: string;
  interviewerName: string;
  interviewerEmail: string;
  jobDepartment: string;
  scheduledDate: string;
  scheduledTime: string;
  timezone: string;
  roomName: string;
  notes: string;
  agentType: AgentType;
};

function formatDate(dateStr: string): string {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString();
}

function toLocalDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toLocalTimeInputValue(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseListInput(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toListInput(value: string[]): string {
  return value.join(', ');
}

function normalizeTab(value: string | null): MainTab {
  if (value === 'positions' || value === 'interviews') return value;
  return 'dashboard';
}

function buildDefaultSetup(defaultRoom: string): SetupFormState {
  const now = new Date();
  return {
    candidateName: '',
    candidateEmail: '',
    interviewerName: '',
    interviewerEmail: '',
    jobDepartment: '',
    scheduledDate: toLocalDateInputValue(now),
    scheduledTime: toLocalTimeInputValue(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    roomName: defaultRoom,
    notes: '',
    agentType: 'classic',
  };
}

function candidateKeyOf(interview: InterviewRecord): string {
  const email = String(interview.candidateEmail || '').trim().toLowerCase();
  const name = String(interview.candidateName || '').trim().toLowerCase();
  return email || name;
}

function interviewRecencyTimestamp(interview: InterviewRecord): number {
  const candidates = [interview.updatedAt, interview.meetingActualEnd, interview.scheduledAt, interview.createdAt];
  for (const value of candidates) {
    const ts = Date.parse(String(value || ''));
    if (!Number.isNaN(ts)) return ts;
  }
  return 0;
}

function clonePosition(position: PositionRecord | PositionConfigCore): PositionConfigCore {
  return {
    role_title: position.role_title,
    role_family: position.role_family,
    level: position.level,
    interview_round_type: position.interview_round_type,
    archetype_id: position.archetype_id,
    duration_minutes: position.duration_minutes,
    must_haves: [...position.must_haves],
    nice_to_haves: [...position.nice_to_haves],
    tech_stack: [...position.tech_stack],
    focus_areas: [...position.focus_areas],
    deep_dive_mode: position.deep_dive_mode,
    strictness: position.strictness,
    evaluation_policy: position.evaluation_policy,
    notes_for_interviewer: position.notes_for_interviewer,
  };
}

export default function Page() {
  const router = useRouter();
  const defaultAgentRoom = 'agent-test-room';

  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [positionsTab, setPositionsTab] = useState<PositionDetailsTab>('job');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);

  const [selectedPositionId, setSelectedPositionId] = useState('');
  const [positionDraft, setPositionDraft] = useState<PositionConfigCore | null>(null);

  const [editingSetupId, setEditingSetupId] = useState('');
  const [selectedOutcomeId, setSelectedOutcomeId] = useState('');
  const [setupForm, setSetupForm] = useState<SetupFormState>(() => buildDefaultSetup(defaultAgentRoom));
  const [reportDraft, setReportDraft] = useState<Record<string, string>>({});

  const selectedOutcome = useMemo(
    () => interviews.find((item) => item.id === selectedOutcomeId),
    [interviews, selectedOutcomeId],
  );

  const selectedPosition = useMemo(
    () => positions.find((item) => item.position_id === selectedPositionId),
    [positions, selectedPositionId],
  );

  const interviewsForSelectedPosition = useMemo(
    () => interviews.filter((item) => item.positionId === selectedPositionId),
    [interviews, selectedPositionId],
  );

  const todayInterviews = useMemo(() => {
    const today = toLocalDateInputValue(new Date());
    return interviews
      .filter((item) => {
        const d = new Date(item.scheduledAt);
        if (Number.isNaN(d.getTime())) return false;
        return toLocalDateInputValue(d) === today;
      })
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [interviews]);

  const pendingFeedback = useMemo(
    () =>
      interviews.filter(
        (item) =>
          item.status === 'completed' &&
          (!item.summaryFeedback || !item.recommendation || typeof item.interviewScore !== 'number'),
      ),
    [interviews],
  );

  const fetchJsonWithTimeout = async (url: string, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({}));
      return { response, json };
    } finally {
      window.clearTimeout(timer);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [interviewResult, positionResult] = await Promise.allSettled([
        fetchJsonWithTimeout('/api/interviews'),
        fetchJsonWithTimeout('/api/positions'),
      ]);

      let nextInterviews: InterviewRecord[] = [];
      let nextPositions: PositionRecord[] = [];
      const errors: string[] = [];

      if (interviewResult.status === 'fulfilled') {
        const { response, json } = interviewResult.value;
        if (response.ok) {
          nextInterviews = Array.isArray(json?.interviews) ? json.interviews : [];
        } else {
          errors.push(json?.error || 'Failed to load interviews');
        }
      } else {
        errors.push('Interviews request timed out or failed');
      }

      if (positionResult.status === 'fulfilled') {
        const { response, json } = positionResult.value;
        if (response.ok && json?.ok !== false) {
          nextPositions = Array.isArray(json?.positions) ? json.positions : [];
        } else {
          errors.push(json?.error || 'Failed to load positions');
        }
      } else {
        errors.push('Positions request timed out or failed');
      }

      setInterviews(nextInterviews);
      setPositions(nextPositions);
      if (errors.length > 0) {
        setError(errors.join(' | '));
      }

      if (!selectedPositionId && nextPositions.length > 0) {
        const first = nextPositions[0];
        setSelectedPositionId(first.position_id);
        setPositionDraft(clonePosition(first));
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tab = normalizeTab(q.get('tab'));
    setActiveTab(tab);
    const interviewId = q.get('interviewId') || '';
    if (interviewId) {
      setSelectedOutcomeId(interviewId);
      setActiveTab('interviews');
    }
    loadData().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPositionId) {
      setPositionDraft(null);
      return;
    }
    const fromList = positions.find((item) => item.position_id === selectedPositionId);
    if (fromList) {
      setPositionDraft(clonePosition(fromList));
    }
  }, [positions, selectedPositionId]);

  useEffect(() => {
    if (!selectedOutcome) return;
    setReportDraft({
      status: selectedOutcome.status,
      meetingActualStart: selectedOutcome.meetingActualStart ?? '',
      meetingActualEnd: selectedOutcome.meetingActualEnd ?? '',
      participantsJoined: selectedOutcome.participantsJoined ?? '',
      recordingUrl: selectedOutcome.recordingUrl ?? '',
      rubricScore: selectedOutcome.rubricScore?.toString() ?? '',
      interviewScore: selectedOutcome.interviewScore?.toString() ?? '',
      recommendation: selectedOutcome.recommendation ?? '',
      summaryFeedback: selectedOutcome.summaryFeedback ?? '',
      detailedFeedback: selectedOutcome.detailedFeedback ?? '',
      nextSteps: selectedOutcome.nextSteps ?? '',
    });
  }, [selectedOutcome]);

  const switchTab = (tab: MainTab) => {
    setActiveTab(tab);
    router.push(`/?tab=${tab}`);
  };

  const openOutcome = (interviewId: string) => {
    const anchor = interviews.find((item) => item.id === interviewId);
    const key = anchor ? candidateKeyOf(anchor) : '';
    const latestForCandidate = key
      ? interviews
          .filter((item) => candidateKeyOf(item) === key)
          .sort((a, b) => interviewRecencyTimestamp(b) - interviewRecencyTimestamp(a))[0]
      : undefined;
    const targetId = latestForCandidate?.id || interviewId;
    setSelectedOutcomeId(targetId);
    setActiveTab('interviews');
    router.push(`/?tab=interviews&interviewId=${encodeURIComponent(targetId)}`);
  };

  const buildInterviewJoinUrl = (interview: InterviewRecord) => {
    const params = new URLSearchParams();
    if (interview.agentType === 'realtime_screening') {
      params.set('agentType', 'realtime_screening');
    }
    const query = params.toString();
    const base = `/rooms/${encodeURIComponent(interview.roomName)}`;
    return query ? `${base}?${query}` : base;
  };

  const startCreateInterview = () => {
    setEditingSetupId('');
    setSetupForm(buildDefaultSetup(defaultAgentRoom));
    setSuccess('');
    setError('');
  };

  const startEditInterview = (interview: InterviewRecord) => {
    const d = new Date(interview.scheduledAt);
    const fallbackDate = Number.isNaN(d.getTime()) ? new Date() : d;
    setEditingSetupId(interview.id);
    setSetupForm({
      candidateName: interview.candidateName,
      candidateEmail: interview.candidateEmail,
      interviewerName: interview.interviewerName,
      interviewerEmail: interview.interviewerEmail,
      jobDepartment: interview.jobDepartment || '',
      scheduledDate: toLocalDateInputValue(fallbackDate),
      scheduledTime: toLocalTimeInputValue(fallbackDate),
      timezone: interview.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      roomName: interview.roomName,
      notes: interview.notes || '',
      agentType: interview.agentType || 'classic',
    });

    if (interview.positionId) {
      setSelectedPositionId(interview.positionId);
      const fromList = positions.find((item) => item.position_id === interview.positionId);
      if (fromList) {
        setPositionDraft(clonePosition(fromList));
      } else if (interview.positionSnapshot) {
        setPositionDraft(clonePosition(interview.positionSnapshot));
      }
    } else if (interview.positionSnapshot) {
      setPositionDraft(clonePosition(interview.positionSnapshot));
    }

    setError('');
    setSuccess('Editing interview setup. Update fields and save.');
  };

  const handleSetupSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!setupForm.scheduledDate || !setupForm.scheduledTime) {
      setError('Please select both interview date and time.');
      return;
    }
    if (!positionDraft || !selectedPositionId) {
      setError('Please select a position before saving interview setup.');
      return;
    }

    setSaving(true);
    const scheduledAt = `${setupForm.scheduledDate}T${setupForm.scheduledTime}`;

    try {
      if (editingSetupId) {
        const payload = {
          candidateName: setupForm.candidateName,
          candidateEmail: setupForm.candidateEmail,
          interviewerName: setupForm.interviewerName,
          interviewerEmail: setupForm.interviewerEmail,
          jobTitle: positionDraft.role_title,
          jobDepartment: setupForm.jobDepartment,
          scheduledAt,
          durationMinutes: positionDraft.duration_minutes,
          timezone: setupForm.timezone,
          notes: setupForm.notes,
          roomName: setupForm.roomName,
          agentType: setupForm.agentType,
          positionId: selectedPositionId,
          positionSnapshot: positionDraft,
        };

        const response = await fetch(`/api/interviews/${editingSetupId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error || 'Failed to update interview setup');
        }
        setSuccess('Interview setup updated.');
      } else {
        const formData = new FormData();
        formData.set('candidateName', setupForm.candidateName);
        formData.set('candidateEmail', setupForm.candidateEmail);
        formData.set('interviewerName', setupForm.interviewerName);
        formData.set('interviewerEmail', setupForm.interviewerEmail);
        formData.set('jobTitle', positionDraft.role_title);
        formData.set('jobDepartment', setupForm.jobDepartment);
        formData.set('scheduledAt', scheduledAt);
        formData.set('durationMinutes', String(positionDraft.duration_minutes));
        formData.set('timezone', setupForm.timezone);
        formData.set('roomName', setupForm.roomName.trim() || defaultAgentRoom);
        formData.set('notes', setupForm.notes);
        formData.set('agentType', setupForm.agentType);
        formData.set('positionId', selectedPositionId);
        formData.set('positionSnapshot', JSON.stringify(positionDraft));

        const cvInput = document.getElementById('candidateCv') as HTMLInputElement | null;
        const cvFile = cvInput?.files?.[0];
        if (cvFile) {
          formData.set('cv', cvFile);
        }

        const response = await fetch('/api/interviews', {
          method: 'POST',
          body: formData,
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error || 'Failed to create interview');
        }
        setSuccess(`Interview setup saved for room ${json.interview.roomName}`);
      }

      await loadData();
      setEditingSetupId('');
      setSetupForm(buildDefaultSetup(defaultAgentRoom));
      const cvInput = document.getElementById('candidateCv') as HTMLInputElement | null;
      if (cvInput) cvInput.value = '';
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save interview setup');
    } finally {
      setSaving(false);
    }
  };

  const saveOutcome = async () => {
    if (!selectedOutcome) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        status: reportDraft.status || selectedOutcome.status,
        meetingActualStart: reportDraft.meetingActualStart || undefined,
        meetingActualEnd: reportDraft.meetingActualEnd || undefined,
        participantsJoined: reportDraft.participantsJoined || undefined,
        recordingUrl: reportDraft.recordingUrl || undefined,
        rubricScore: reportDraft.rubricScore ? Number(reportDraft.rubricScore) : undefined,
        interviewScore: reportDraft.interviewScore ? Number(reportDraft.interviewScore) : undefined,
        recommendation: reportDraft.recommendation as Recommendation,
        summaryFeedback: reportDraft.summaryFeedback || undefined,
        detailedFeedback: reportDraft.detailedFeedback || undefined,
        nextSteps: reportDraft.nextSteps || undefined,
      };

      const response = await fetch(`/api/interviews/${selectedOutcome.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Failed to save interview outcome');
      }

      setSuccess('Interview outcome updated.');
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save interview outcome');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <main className={styles.main} data-lk-theme="default">
        <div className={styles.heroCard}>
          <section className={styles.heroContent}>
            <img src="/images/bristlecone-logo.png" alt="Bristlecone" className={styles.brandLogo} />
            <h1 className={styles.heroTitle}>Bristlecone Technical Interaction</h1>
            <h2 className={styles.heroSubtitle}>
              A focused platform for technical evaluation and screening of job applicants through
              structured live interaction.
            </h2>
          </section>
          <aside className={styles.heroVisual} aria-hidden="true">
            <div className={styles.heroRingOuter}>
              <div className={styles.heroRingInner}>
                <div className={styles.heroOrb} />
              </div>
            </div>
          </aside>
        </div>

        <div className={styles.tabContainer}>
          <div className={styles.tabSelect}>
            <button type="button" className="lk-button" aria-pressed={activeTab === 'dashboard'} onClick={() => switchTab('dashboard')}>
              Dashboard
            </button>
            <button type="button" className="lk-button" aria-pressed={activeTab === 'positions'} onClick={() => switchTab('positions')}>
              Positions
            </button>
            <button type="button" className="lk-button" aria-pressed={activeTab === 'interviews'} onClick={() => switchTab('interviews')}>
              Interviews
            </button>
          </div>

          {error ? <p className={styles.errorText}>{error}</p> : null}
          {success ? <p className={styles.successText}>{success}</p> : null}
          {loading ? <p>Loading data...</p> : null}

          {!loading && activeTab === 'dashboard' ? (
            <div className={styles.tabContent}>
              <h3 style={{ margin: 0 }}>Today&apos;s Interviews</h3>
              {todayInterviews.length === 0 ? <p>No interviews scheduled for today.</p> : null}
              <div className={styles.interviewList}>
                {todayInterviews.map((item) => (
                  <div key={item.id} className={styles.interviewCard}>
                    <div className={styles.interviewHeader}>
                      <strong>{item.candidateName}</strong>
                      <span>{new Date(item.scheduledAt).toLocaleTimeString()}</span>
                    </div>
                    <div className={styles.interviewMeta}>
                      <span>{item.jobTitle}</span>
                      <span>{item.status.toUpperCase()}</span>
                      <span>{`Room ${item.roomName}`}</span>
                    </div>
                    <div className={styles.cardButtons}>
                      <button type="button" className="lk-button" onClick={() => router.push(buildInterviewJoinUrl(item))}>
                        Join
                      </button>
                      <button type="button" className="lk-button" onClick={() => openOutcome(item.id)}>
                        View details
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <h3 style={{ marginBottom: 0 }}>Pending Feedback</h3>
              {pendingFeedback.length === 0 ? <p>No pending feedback items.</p> : null}
              <div className={styles.interviewList}>
                {pendingFeedback.map((item) => (
                  <div key={item.id} className={styles.interviewCard}>
                    <div className={styles.interviewHeader}>
                      <strong>{item.candidateName}</strong>
                      <span>{item.jobTitle}</span>
                    </div>
                    <div className={styles.cardButtons}>
                      <button type="button" className="lk-button" onClick={() => openOutcome(item.id)}>
                        Complete feedback
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!loading && activeTab === 'positions' ? (
            <div className={styles.tabContent}>
              <div className={styles.cardButtons}>
                <button type="button" className="lk-button" onClick={() => switchTab('dashboard')}>
                  Back to Home
                </button>
                <button type="button" className="lk-button" onClick={() => router.push('/positions/new')}>
                  New Position Setup
                </button>
                <button type="button" className="lk-button" onClick={() => router.push('/positions/new')}>
                  Edit Positions
                </button>
              </div>

              {positions.length === 0 ? <p>No positions found. Create one from New Position Setup.</p> : null}
              {positions.length > 0 ? (
                <>
                  <select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)}>
                    {positions.map((p) => (
                      <option key={p.position_id} value={p.position_id}>
                        {p.role_title} ({p.role_family}/{p.level})
                      </option>
                    ))}
                  </select>

                  {selectedPosition && positionDraft ? (
                    <>
                      <div className={styles.tabSelect}>
                        <button type="button" className="lk-button" aria-pressed={positionsTab === 'job'} onClick={() => setPositionsTab('job')}>
                          Job Description
                        </button>
                        <button type="button" className="lk-button" aria-pressed={positionsTab === 'plan'} onClick={() => setPositionsTab('plan')}>
                          Interview Plan
                        </button>
                        <button type="button" className="lk-button" aria-pressed={positionsTab === 'candidates'} onClick={() => setPositionsTab('candidates')}>
                          Candidates
                        </button>
                        <button type="button" className="lk-button" aria-pressed={positionsTab === 'interviews'} onClick={() => setPositionsTab('interviews')}>
                          Interviews
                        </button>
                      </div>

                      {positionsTab === 'job' ? (
                        <div className={styles.reportPanel}>
                          <h4 style={{ marginTop: 0 }}>{positionDraft.role_title}</h4>
                          <p className={styles.interviewMeta}>{positionDraft.notes_for_interviewer || 'No JD notes saved for this position.'}</p>
                          <p className={styles.interviewMeta}>{`Role family: ${positionDraft.role_family} | Level: ${positionDraft.level}`}</p>
                        </div>
                      ) : null}

                      {positionsTab === 'plan' ? (
                        <div className={styles.reportPanel}>
                          <p className={styles.interviewMeta}>{`Round: ${positionDraft.interview_round_type} | Archetype: ${positionDraft.archetype_id} | Duration: ${positionDraft.duration_minutes}m`}</p>
                          <p className={styles.interviewMeta}>{`Focus areas: ${positionDraft.focus_areas.join(', ') || 'None'}`}</p>
                          <p className={styles.interviewMeta}>{`Scorecard policy: ${positionDraft.evaluation_policy} | Strictness: ${positionDraft.strictness}`}</p>
                          <p className={styles.interviewMeta}>{`Question sets / must-haves: ${positionDraft.must_haves.join(', ') || 'None'}`}</p>
                        </div>
                      ) : null}

                      {positionsTab === 'candidates' ? (
                        <div className={styles.interviewList}>
                          {interviewsForSelectedPosition.length === 0 ? <p>No candidates in pipeline yet.</p> : null}
                          {interviewsForSelectedPosition.map((item) => (
                            <div key={item.id} className={styles.interviewCard}>
                              <div className={styles.interviewHeader}>
                                <strong>{item.candidateName}</strong>
                                <span>{item.status.toUpperCase()}</span>
                              </div>
                              <div className={styles.interviewMeta}>
                                <span>{item.candidateEmail}</span>
                                <span>{formatDate(item.scheduledAt)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {positionsTab === 'interviews' ? (
                        <div className={styles.interviewList}>
                          {interviewsForSelectedPosition.length === 0 ? <p>No interviews scheduled/completed for this position.</p> : null}
                          {interviewsForSelectedPosition.map((item) => (
                            <div key={item.id} className={styles.interviewCard}>
                              <div className={styles.interviewHeader}>
                                <strong>{item.candidateName}</strong>
                                <span>{item.status.toUpperCase()}</span>
                              </div>
                              <div className={styles.interviewMeta}>
                                <span>{formatDate(item.scheduledAt)}</span>
                                <span>{`Room ${item.roomName}`}</span>
                              </div>
                              <div className={styles.cardButtons}>
                                <button type="button" className="lk-button" onClick={() => router.push(buildInterviewJoinUrl(item))}>
                                  Join
                                </button>
                                <button type="button" className="lk-button" onClick={() => openOutcome(item.id)}>
                                  View outcomes
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {!loading && activeTab === 'interviews' ? (
            <div className={styles.tabContent}>
              <h3 style={{ margin: 0 }}>{editingSetupId ? 'Edit Interview Setup' : 'Interview Room Setup'}</h3>
              <form onSubmit={handleSetupSubmit} className={styles.formGrid}>
                <input
                  value={setupForm.candidateName}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, candidateName: e.target.value }))}
                  placeholder="Candidate Name*"
                  required
                />
                <input
                  value={setupForm.candidateEmail}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, candidateEmail: e.target.value }))}
                  type="email"
                  placeholder="Candidate Email*"
                  required
                />
                <input
                  value={setupForm.interviewerName}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, interviewerName: e.target.value }))}
                  placeholder="Interviewer Name*"
                  required
                />
                <input
                  value={setupForm.interviewerEmail}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, interviewerEmail: e.target.value }))}
                  type="email"
                  placeholder="Interviewer Email"
                />

                <select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)} required>
                  <option value="">Select Open Position*</option>
                  {positions.map((position) => (
                    <option key={position.position_id} value={position.position_id}>
                      {position.role_title} ({position.role_family}/{position.level})
                    </option>
                  ))}
                </select>

                <input
                  value={setupForm.jobDepartment}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, jobDepartment: e.target.value }))}
                  placeholder="Department / Function"
                />
                <input
                  type="date"
                  value={setupForm.scheduledDate}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, scheduledDate: e.target.value }))}
                  required
                />
                <input
                  type="time"
                  step={60}
                  value={setupForm.scheduledTime}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, scheduledTime: e.target.value }))}
                  required
                />
                <input
                  type="text"
                  value={setupForm.timezone}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, timezone: e.target.value }))}
                  placeholder="Timezone"
                  required
                />
                <input
                  type="text"
                  value={setupForm.roomName}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, roomName: e.target.value }))}
                  placeholder="Room Name"
                  required
                />
                <select
                  value={setupForm.agentType}
                  onChange={(e) =>
                    setSetupForm((prev) => ({ ...prev, agentType: e.target.value as AgentType }))
                  }
                >
                  <option value="classic">Classic Interview Agent</option>
                  <option value="realtime_screening">Realtime Screening Agent (10 min)</option>
                </select>

                {positionDraft ? (
                  <>
                    <input
                      value={positionDraft.role_title}
                      onChange={(e) => setPositionDraft((prev) => (prev ? { ...prev, role_title: e.target.value } : prev))}
                      placeholder="Job Title"
                      required
                    />
                    <select
                      value={positionDraft.role_family}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, role_family: e.target.value as PositionConfigCore['role_family'] } : prev,
                        )
                      }
                    >
                      {ROLE_FAMILIES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.level}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, level: e.target.value as PositionConfigCore['level'] } : prev,
                        )
                      }
                    >
                      {LEVELS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.interview_round_type}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                interview_round_type: e.target.value as PositionConfigCore['interview_round_type'],
                              }
                            : prev,
                        )
                      }
                    >
                      {INTERVIEW_ROUND_TYPES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.archetype_id}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, archetype_id: e.target.value as PositionConfigCore['archetype_id'] } : prev,
                        )
                      }
                    >
                      {ARCHETYPES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.duration_minutes}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                duration_minutes: Number(e.target.value) as PositionConfigCore['duration_minutes'],
                              }
                            : prev,
                        )
                      }
                    >
                      {DURATIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.deep_dive_mode}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                deep_dive_mode: e.target.value as PositionConfigCore['deep_dive_mode'],
                              }
                            : prev,
                        )
                      }
                    >
                      {DEEP_DIVE_MODES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.strictness}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, strictness: e.target.value as PositionConfigCore['strictness'] } : prev,
                        )
                      }
                    >
                      {STRICTNESS_LEVELS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      value={positionDraft.evaluation_policy}
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                evaluation_policy: e.target.value as PositionConfigCore['evaluation_policy'],
                              }
                            : prev,
                        )
                      }
                    >
                      {EVALUATION_POLICIES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>

                    <textarea
                      rows={2}
                      value={toListInput(positionDraft.must_haves)}
                      placeholder="Must haves (comma separated)"
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, must_haves: parseListInput(e.target.value).slice(0, 8) } : prev,
                        )
                      }
                    />
                    <textarea
                      rows={2}
                      value={toListInput(positionDraft.nice_to_haves)}
                      placeholder="Nice to haves (comma separated)"
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, nice_to_haves: parseListInput(e.target.value).slice(0, 8) } : prev,
                        )
                      }
                    />
                    <textarea
                      rows={2}
                      value={toListInput(positionDraft.tech_stack)}
                      placeholder="Tech stack (comma separated)"
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, tech_stack: parseListInput(e.target.value).slice(0, 15) } : prev,
                        )
                      }
                    />
                    <textarea
                      rows={2}
                      value={toListInput(positionDraft.focus_areas)}
                      placeholder="Focus areas (comma separated)"
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                focus_areas: parseListInput(e.target.value)
                                  .map((v) => v.toLowerCase().replace(/\s+/g, '_'))
                                  .filter(
                                    (v): v is PositionConfigCore['focus_areas'][number] =>
                                      FOCUS_AREAS.includes(v as PositionConfigCore['focus_areas'][number]),
                                  )
                                  .slice(0, 4),
                              }
                            : prev,
                        )
                      }
                    />
                    <textarea
                      rows={3}
                      value={positionDraft.notes_for_interviewer}
                      placeholder="Position notes for interviewer"
                      onChange={(e) =>
                        setPositionDraft((prev) =>
                          prev ? { ...prev, notes_for_interviewer: e.target.value.slice(0, 600) } : prev,
                        )
                      }
                    />
                  </>
                ) : null}

                {!editingSetupId ? (
                  <label className={styles.fileLabel}>
                    Candidate CV
                    <input id="candidateCv" type="file" accept=".pdf,.doc,.docx,.txt" />
                  </label>
                ) : null}

                <textarea
                  rows={3}
                  value={setupForm.notes}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional setup notes / constraints"
                />

                <div className={styles.cardButtons}>
                  <button className="lk-button" type="submit" disabled={saving}>
                    {saving ? 'Saving...' : editingSetupId ? 'Update Interview Setup' : 'Save Interview Setup'}
                  </button>
                  {editingSetupId ? (
                    <button type="button" className="lk-button" onClick={startCreateInterview}>
                      Cancel Edit
                    </button>
                  ) : null}
                </div>
              </form>

              <h3 style={{ marginBottom: 0 }}>Interviews</h3>
              {interviews.length === 0 ? <p>No interviews configured yet.</p> : null}

              <div className={styles.interviewList}>
                {interviews.map((item) => (
                  <div key={item.id} className={styles.interviewCard}>
                    <div className={styles.interviewHeader}>
                      <strong>{item.candidateName}</strong>
                      <span>{item.status.toUpperCase()}</span>
                    </div>
                    <div className={styles.interviewMeta}>
                      <span>{item.jobTitle}</span>
                      <span>{formatDate(item.scheduledAt)}</span>
                      <span>{`Duration ${item.durationMinutes} min`}</span>
                      <span>{item.agentType === 'realtime_screening' ? 'Agent: Realtime Screening' : 'Agent: Classic'}</span>
                      <span>{`Room ${item.roomName}`}</span>
                    </div>
                    <div className={styles.cardButtons}>
                      <button type="button" className="lk-button" onClick={() => startEditInterview(item)}>
                        Edit setup
                      </button>
                      <button type="button" className="lk-button" onClick={() => router.push(buildInterviewJoinUrl(item))}>
                        Join
                      </button>
                      <button type="button" className="lk-button" onClick={() => openOutcome(item.id)}>
                        View outcomes
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {selectedOutcome ? (
                <div className={styles.reportPanel}>
                  <h4 style={{ marginTop: 0 }}>{`Interview Output: ${selectedOutcome.candidateName}`}</h4>
                  <div className={styles.reportGrid}>
                    <select
                      value={reportDraft.status ?? ''}
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, status: e.target.value }))}
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <input
                      type="datetime-local"
                      value={reportDraft.meetingActualStart ?? ''}
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, meetingActualStart: e.target.value }))}
                      title="Actual start"
                    />
                    <input
                      type="datetime-local"
                      value={reportDraft.meetingActualEnd ?? ''}
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, meetingActualEnd: e.target.value }))}
                      title="Actual end"
                    />
                    <input
                      value={reportDraft.recordingUrl ?? ''}
                      placeholder="Recording URL (S3/http)"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, recordingUrl: e.target.value }))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={reportDraft.rubricScore ?? ''}
                      placeholder="Rubric Score (0-10)"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, rubricScore: e.target.value }))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={reportDraft.interviewScore ?? ''}
                      placeholder="Interview Score (0-100)"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, interviewScore: e.target.value }))}
                    />
                    <select
                      value={reportDraft.recommendation ?? ''}
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, recommendation: e.target.value }))}
                    >
                      <option value="">Recommendation</option>
                      <option value="strong_hire">Strong Hire</option>
                      <option value="hire">Hire</option>
                      <option value="hold">Hold</option>
                      <option value="no_hire">No Hire</option>
                    </select>
                    <textarea
                      rows={2}
                      value={reportDraft.participantsJoined ?? ''}
                      placeholder="Participants joined (names/emails)"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, participantsJoined: e.target.value }))}
                    />
                    <textarea
                      rows={3}
                      value={reportDraft.summaryFeedback ?? ''}
                      placeholder="Summary interview feedback"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, summaryFeedback: e.target.value }))}
                    />
                    <textarea
                      rows={5}
                      value={reportDraft.detailedFeedback ?? ''}
                      placeholder="Detailed interview feedback"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, detailedFeedback: e.target.value }))}
                    />
                    <textarea
                      rows={3}
                      value={reportDraft.nextSteps ?? ''}
                      placeholder="Recommendation rationale / next steps"
                      onChange={(e) => setReportDraft((prev) => ({ ...prev, nextSteps: e.target.value }))}
                    />
                  </div>

                  <div className={styles.assetRow}>
                    {selectedOutcome.cv ? (
                      <a href={`/api/interviews/${selectedOutcome.id}/asset?kind=cv`} target="_blank" rel="noreferrer">
                        Download CV
                      </a>
                    ) : (
                      <span>CV not uploaded</span>
                    )}
                    {selectedOutcome.jd ? (
                      <a href={`/api/interviews/${selectedOutcome.id}/asset?kind=jd`} target="_blank" rel="noreferrer">
                        Download JD
                      </a>
                    ) : (
                      <span>JD not uploaded</span>
                    )}
                  </div>

                  <div className={styles.cardButtons}>
                    <button type="button" className="lk-button" onClick={saveOutcome} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Interview Output'}
                    </button>
                    <button type="button" className="lk-button" onClick={() => setSelectedOutcomeId('')}>
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
      <footer data-lk-theme="default">
        Bristlecone Technical Interaction helps hiring teams run consistent, high-signal technical
        screening interviews.
      </footer>
    </>
  );
}
