'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { encodePassphrase, generateRoomId, randomString } from '@/lib/client-utils';
import styles from '../styles/Home.module.css';

type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | '';

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

function Tabs(props: React.PropsWithChildren<{}>) {
  const [tabIndex, setTabIndex] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tab = q.get('tab');
    if (tab === 'custom') setTabIndex(1);
    else if (tab === 'setup') setTabIndex(2);
    else setTabIndex(0);
  }, []);

  function onTabSelected(index: number) {
    const tab = index === 1 ? 'custom' : index === 2 ? 'setup' : 'demo';
    setTabIndex(index);
    router.push(`/?tab=${tab}`);
  }

  const tabs = React.Children.map(props.children, (child, index) => (
    <button
      type="button"
      className="lk-button"
      onClick={() => onTabSelected(index)}
      aria-pressed={tabIndex === index}
    >
      {/* @ts-ignore */}
      {child?.props.label}
    </button>
  ));

  return (
    <div className={styles.tabContainer}>
      <div className={styles.tabSelect}>{tabs}</div>
      {/* @ts-ignore */}
      {props.children[tabIndex]}
    </div>
  );
}

function DemoMeetingTab(props: { label: string }) {
  const router = useRouter();
  const [e2ee, setE2ee] = useState(false);
  const [sharedPassphrase, setSharedPassphrase] = useState(randomString(64));
  const [roomName, setRoomName] = useState('agent-test-room');
  const startMeeting = () => {
    const targetRoom = roomName.trim() || generateRoomId();
    if (e2ee) {
      router.push(`/rooms/${encodeURIComponent(targetRoom)}#${encodePassphrase(sharedPassphrase)}`);
    } else {
      router.push(`/rooms/${encodeURIComponent(targetRoom)}`);
    }
  };
  return (
    <div className={styles.tabContent}>
      <p style={{ margin: 0 }}>
        Start a technical interview room with real-time audio/video for interviewer-candidate
        screening.
      </p>
      <input
        id="roomName"
        type="text"
        value={roomName}
        onChange={(ev) => setRoomName(ev.target.value)}
        placeholder="Room name (e.g. agent-test-room)"
      />
      <button style={{ marginTop: '1rem' }} className="lk-button" onClick={startMeeting}>
        Start Interview
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
          <input
            id="use-e2ee"
            type="checkbox"
            checked={e2ee}
            onChange={(ev) => setE2ee(ev.target.checked)}
          ></input>
          <label htmlFor="use-e2ee">Enable end-to-end encryption</label>
        </div>
        {e2ee && (
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <label htmlFor="passphrase">Passphrase</label>
            <input
              id="passphrase"
              type="password"
              value={sharedPassphrase}
              onChange={(ev) => setSharedPassphrase(ev.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CustomConnectionTab(props: { label: string }) {
  const router = useRouter();
  const [e2ee, setE2ee] = useState(false);
  const [sharedPassphrase, setSharedPassphrase] = useState(randomString(64));

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const serverUrl = formData.get('serverUrl');
    const token = formData.get('token');
    if (e2ee) {
      router.push(
        `/custom/?liveKitUrl=${serverUrl}&token=${token}#${encodePassphrase(sharedPassphrase)}`,
      );
    } else {
      router.push(`/custom/?liveKitUrl=${serverUrl}&token=${token}`);
    }
  };
  return (
    <form className={styles.tabContent} onSubmit={onSubmit}>
      <p style={{ marginTop: 0 }}>
        Connect to your own signaling/media backend using a server URL and an access token.
      </p>
      <input
        id="serverUrl"
        name="serverUrl"
        type="url"
        placeholder="Server URL: ws://localhost:7880 or wss://your-domain"
        required
      />
      <textarea
        id="token"
        name="token"
        placeholder="Token"
        required
        rows={5}
        style={{ padding: '1px 2px', fontSize: 'inherit', lineHeight: 'inherit' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
          <input
            id="use-e2ee-custom"
            type="checkbox"
            checked={e2ee}
            onChange={(ev) => setE2ee(ev.target.checked)}
          ></input>
          <label htmlFor="use-e2ee-custom">Enable end-to-end encryption</label>
        </div>
        {e2ee && (
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <label htmlFor="passphrase">Passphrase</label>
            <input
              id="passphrase"
              type="password"
              value={sharedPassphrase}
              onChange={(ev) => setSharedPassphrase(ev.target.value)}
            />
          </div>
        )}
      </div>

      <hr
        style={{ width: '100%', borderColor: 'rgba(30, 65, 90, 0.2)', marginBlock: '1rem' }}
      />
      <button
        style={{ paddingInline: '1.25rem', width: '100%' }}
        className="lk-button"
        type="submit"
      >
        Connect Session
      </button>
    </form>
  );
}

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

function InterviewOpsTab(props: { label: string }) {
  const router = useRouter();
  const defaultAgentRoom = 'agent-test-room';
  const [scheduledDate, setScheduledDate] = useState(() => toLocalDateInputValue(new Date()));
  const [scheduledTime, setScheduledTime] = useState(() => toLocalTimeInputValue(new Date()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [reportError, setReportError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [reportDraft, setReportDraft] = useState<Record<string, string>>({});

  const selectedInterview = useMemo(
    () => interviews.find((item) => item.id === selectedId),
    [interviews, selectedId],
  );

  const refreshInterviews = async () => {
    setLoading(true);
    setSetupError('');
    try {
      const response = await fetch('/api/interviews', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Failed to load interviews');
      }
      setInterviews(json.interviews ?? []);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Failed to load interviews');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshInterviews().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedInterview) return;
    setReportDraft({
      status: selectedInterview.status,
      meetingActualStart: selectedInterview.meetingActualStart ?? '',
      meetingActualEnd: selectedInterview.meetingActualEnd ?? '',
      participantsJoined: selectedInterview.participantsJoined ?? '',
      recordingUrl: selectedInterview.recordingUrl ?? '',
      rubricScore: selectedInterview.rubricScore?.toString() ?? '',
      interviewScore: selectedInterview.interviewScore?.toString() ?? '',
      recommendation: selectedInterview.recommendation ?? '',
      summaryFeedback: selectedInterview.summaryFeedback ?? '',
      detailedFeedback: selectedInterview.detailedFeedback ?? '',
      nextSteps: selectedInterview.nextSteps ?? '',
    });
  }, [selectedInterview]);

  const handleSetupSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setSetupError('');
    setSuccessMsg('');
    const formData = new FormData(event.currentTarget);
    const selectedDate = String(formData.get('scheduledDate') ?? '').trim();
    const selectedTime = String(formData.get('scheduledTime') ?? '').trim();
    if (!selectedDate || !selectedTime) {
      setSetupError('Please select both interview date and time.');
      return;
    }
    formData.set('scheduledAt', `${selectedDate}T${selectedTime}`);
    formData.delete('scheduledDate');
    formData.delete('scheduledTime');
    if (!String(formData.get('roomName') ?? '').trim()) {
      formData.set('roomName', defaultAgentRoom);
    }

    try {
      const response = await fetch('/api/interviews', {
        method: 'POST',
        body: formData,
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Failed to create interview');
      }
      event.currentTarget.reset();
      setScheduledDate(toLocalDateInputValue(new Date()));
      setScheduledTime(toLocalTimeInputValue(new Date()));
      setSuccessMsg(`Interview setup saved for room ${json.interview.roomName}`);
      await refreshInterviews();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Failed to create interview');
    }
  };

  const saveReport = async () => {
    if (!selectedInterview) return;
    setReportError('');
    setSaving(true);
    const payload = {
      status: reportDraft.status || selectedInterview.status,
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
    try {
      const response = await fetch(`/api/interviews/${selectedInterview.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Failed to save report');
      }
      setSuccessMsg('Interview report updated.');
      await refreshInterviews();
      setSelectedId(json.interview.id);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Failed to save report');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.tabContent}>
      <h3 style={{ margin: 0 }}>Interview Room Setup</h3>
      <form onSubmit={handleSetupSubmit} className={styles.formGrid}>
        <input name="candidateName" placeholder="Candidate Name*" required />
        <input name="candidateEmail" type="email" placeholder="Candidate Email*" required />
        <input name="interviewerName" placeholder="Interviewer Name*" required />
        <input name="interviewerEmail" type="email" placeholder="Interviewer Email" />
        <input name="jobTitle" placeholder="Job Title*" required />
        <input name="jobDepartment" placeholder="Department / Function" />
        <input
          name="scheduledDate"
          type="date"
          title="Scheduled date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          required
        />
        <input
          name="scheduledTime"
          type="time"
          step={60}
          title="Scheduled time"
          value={scheduledTime}
          onChange={(e) => setScheduledTime(e.target.value)}
          required
        />
        <input name="durationMinutes" type="number" min={5} defaultValue={45} required />
        <input name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} />
        <input name="roomName" defaultValue={defaultAgentRoom} placeholder="Room Name (optional)" />
        <label className={styles.fileLabel}>
          Candidate CV
          <input name="cv" type="file" accept=".pdf,.doc,.docx,.txt" />
        </label>
        <label className={styles.fileLabel}>
          Job Description
          <input name="jd" type="file" accept=".pdf,.doc,.docx,.txt" />
        </label>
        <textarea name="notes" placeholder="Additional setup notes / constraints" rows={3} />
        <button className="lk-button" type="submit">
          Save Interview Setup
        </button>
      </form>

      {setupError ? <p className={styles.errorText}>{setupError}</p> : null}
      {reportError ? <p className={styles.errorText}>{reportError}</p> : null}
      {successMsg ? <p className={styles.successText}>{successMsg}</p> : null}

      <h3 style={{ marginBottom: 0 }}>Interview Meetings & Outcomes</h3>
      {loading ? <p>Loading interviews...</p> : null}
      {!loading && interviews.length === 0 ? <p>No interviews configured yet.</p> : null}

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
              <span>{`Room ${item.roomName}`}</span>
            </div>
            <div className={styles.cardButtons}>
              <button
                type="button"
                className="lk-button"
                onClick={() => router.push(`/rooms/${encodeURIComponent(item.roomName)}`)}
              >
                Join (Ready Page)
              </button>
              <button
                type="button"
                className="lk-button"
                onClick={() =>
                  router.push(
                    `/rooms/${encodeURIComponent(item.roomName)}?autojoin=1&name=${encodeURIComponent(item.interviewerName || 'Moderator')}`,
                  )
                }
              >
                Join (Direct)
              </button>
              <button
                type="button"
                className="lk-button"
                onClick={() => setSelectedId(item.id)}
              >
                View / Edit Output
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedInterview ? (
        <div className={styles.reportPanel}>
          <h4 style={{ marginTop: 0 }}>{`Interview Output: ${selectedInterview.candidateName}`}</h4>
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
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, meetingActualStart: e.target.value }))
              }
              title="Actual start"
            />
            <input
              type="datetime-local"
              value={reportDraft.meetingActualEnd ?? ''}
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, meetingActualEnd: e.target.value }))
              }
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
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, interviewScore: e.target.value }))
              }
            />
            <select
              value={reportDraft.recommendation ?? ''}
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, recommendation: e.target.value }))
              }
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
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, participantsJoined: e.target.value }))
              }
            />
            <textarea
              rows={3}
              value={reportDraft.summaryFeedback ?? ''}
              placeholder="Summary interview feedback"
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, summaryFeedback: e.target.value }))
              }
            />
            <textarea
              rows={5}
              value={reportDraft.detailedFeedback ?? ''}
              placeholder="Detailed interview feedback"
              onChange={(e) =>
                setReportDraft((prev) => ({ ...prev, detailedFeedback: e.target.value }))
              }
            />
            <textarea
              rows={3}
              value={reportDraft.nextSteps ?? ''}
              placeholder="Recommendation rationale / next steps"
              onChange={(e) => setReportDraft((prev) => ({ ...prev, nextSteps: e.target.value }))}
            />
          </div>

          <div className={styles.assetRow}>
            {selectedInterview.cv ? (
              <a
                href={`/api/interviews/${selectedInterview.id}/asset?kind=cv`}
                target="_blank"
                rel="noreferrer"
              >
                Download CV
              </a>
            ) : (
              <span>CV not uploaded</span>
            )}
            {selectedInterview.jd ? (
              <a
                href={`/api/interviews/${selectedInterview.id}/asset?kind=jd`}
                target="_blank"
                rel="noreferrer"
              >
                Download JD
              </a>
            ) : (
              <span>JD not uploaded</span>
            )}
          </div>

          <div className={styles.cardButtons}>
            <button type="button" className="lk-button" onClick={saveReport} disabled={saving}>
              {saving ? 'Saving...' : 'Save Interview Output'}
            </button>
            <button type="button" className="lk-button" onClick={() => setSelectedId('')}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
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
        <Tabs>
          <DemoMeetingTab label="Interview Room" />
          <CustomConnectionTab label="Manual Connect" />
          <InterviewOpsTab label="Setup & Reports" />
        </Tabs>
      </main>
      <footer data-lk-theme="default">
        Bristlecone Technical Interaction helps hiring teams run consistent, high-signal technical
        screening interviews.
      </footer>
    </>
  );
}
