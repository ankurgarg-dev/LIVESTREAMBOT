'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import {
  DEEP_DIVE_MODES,
  DURATIONS,
  EVALUATION_POLICIES,
  FOCUS_AREAS,
  LEVELS,
  STRICTNESS_LEVELS,
  type PositionConfigCore,
} from '@/lib/position/types';
import styles from '../styles/Home.module.css';

type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | '';
type AgentType = 'classic' | 'realtime_screening';
type MainTab = 'dashboard' | 'positions' | 'candidates' | 'applications' | 'interviews' | 'settings';
type SkillCalibrationCategory = 'must_have' | 'nice_to_have';
type SkillCalibrationItem = {
  skill: string;
  category: SkillCalibrationCategory;
  definition: string;
  weight_percent: number;
};
type AgentPromptSettings = {
  classicPrompt: string;
  realtimePrompt: string;
  screeningMaxMinutes: number;
  sttVadRmsThreshold: number;
  sttMinSpeechMs: number;
  sttMaxSilenceMs: number;
  sttMaxUtteranceMs: number;
  sttMinTranscribeMs: number;
  sttGraceMs: number;
  updatedAt?: string;
};

const DEFAULT_AGENT_SETTINGS: AgentPromptSettings = {
  classicPrompt: '',
  realtimePrompt: '',
  screeningMaxMinutes: 10,
  sttVadRmsThreshold: 0.0035,
  sttMinSpeechMs: 350,
  sttMaxSilenceMs: 900,
  sttMaxUtteranceMs: 30000,
  sttMinTranscribeMs: 400,
  sttGraceMs: 350,
};

type InterviewAssetMeta = {
  originalName: string;
  storedName: string;
  contentType: string;
  size: number;
};

type CvJdSkillScore = {
  skill: string;
  category: 'must_have' | 'common';
  matched: boolean;
  matchType: 'exact' | 'partial' | 'none';
  score: number;
  oneLiner: string;
};

type CvJdScorecard = {
  overallScore: number;
  mustHaveScore: number;
  commonSkillScore: number;
  mustHaveMatched: number;
  mustHaveTotal: number;
  commonMatched: number;
  commonTotal: number;
  summary: string;
  details: CvJdSkillScore[];
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
  transcriptText?: string;
  cvJdScorecard?: CvJdScorecard;
  createdAt: string;
  updatedAt: string;
};

type PositionRecord = PositionConfigCore & {
  position_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};
type CandidateProfile = {
  id: string;
  fullName: string;
  email: string;
  currentTitle?: string;
  yearsExperience?: string;
  keySkills?: string[];
  candidateContext?: string;
  createdAt: string;
  updatedAt: string;
};
type CandidateScreening = {
  candidateId: string;
  positionId: string;
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  blendedScore?: number;
  blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  updatedAt?: string;
  cvJdScorecard?: CvJdScorecard;
  aiScreening?: {
    score: number;
    summary: string;
    strengths: string[];
    gaps: string[];
    reasoning: string[];
    model: string;
  };
};

type ApplicationRecord = {
  id: string;
  positionId: string;
  candidateId?: string;
  candidateName: string;
  candidateEmail: string;
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  blendedScore?: number;
  blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  roomName?: string;
  interviewAgentType?: AgentType;
  createdAt: string;
  updatedAt: string;
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

function formatScoreTag(scorecard: CvJdScorecard | undefined): string {
  if (!scorecard || typeof scorecard.overallScore !== 'number') return 'CV-JD N/A';
  return `CV-JD ${Math.max(0, Math.min(100, Math.round(scorecard.overallScore)))}`;
}

function normalizeSkillCalibration(input: SkillCalibrationItem[]): SkillCalibrationItem[] {
  const out: SkillCalibrationItem[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    const skill = String(row.skill || '').trim();
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      skill,
      category: row.category === 'nice_to_have' ? 'nice_to_have' : 'must_have',
      definition: String(row.definition || '').trim().slice(0, 260),
      weight_percent: Math.max(0, Math.min(100, Math.round(Number(row.weight_percent) || 0))),
    });
  }
  return out.slice(0, 20);
}

function buildSkillCalibrationDraft(position: PositionConfigCore | null): SkillCalibrationItem[] {
  if (!position) return [];
  const seeded = Array.isArray(position.skills_calibration)
    ? normalizeSkillCalibration(position.skills_calibration as SkillCalibrationItem[])
    : [];
  const seen = new Set(seeded.map((row) => row.skill.toLowerCase()));
  const out = [...seeded];
  for (const skill of position.must_haves || []) {
    const key = String(skill || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ skill, category: 'must_have', definition: '', weight_percent: 60 });
  }
  for (const skill of position.nice_to_haves || []) {
    const key = String(skill || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ skill, category: 'nice_to_have', definition: '', weight_percent: 20 });
  }
  return out.slice(0, 20);
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
  if (
    value === 'positions' ||
    value === 'candidates' ||
    value === 'applications' ||
    value === 'interviews' ||
    value === 'settings'
  ) {
    return value;
  }
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

function candidateKeyFromApplication(application: ApplicationRecord): string {
  const email = String(application.candidateEmail || '').trim().toLowerCase();
  const name = String(application.candidateName || '').trim().toLowerCase();
  return email || name;
}

function interviewHasStarted(interview: InterviewRecord): boolean {
  return Boolean(
    String(interview.meetingActualStart || '').trim() ||
      String(interview.transcriptText || '').trim() ||
      String(interview.summaryFeedback || '').trim() ||
      interview.status === 'completed',
  );
}

function clonePosition(position: PositionRecord | PositionConfigCore): PositionConfigCore {
  return {
    role_title: position.role_title,
    level: position.level,
    duration_minutes: position.duration_minutes,
    must_haves: [...position.must_haves],
    nice_to_haves: [...position.nice_to_haves],
    tech_stack: [...position.tech_stack],
    focus_areas: [...position.focus_areas],
    deep_dive_mode: position.deep_dive_mode,
    strictness: position.strictness,
    evaluation_policy: position.evaluation_policy,
    notes_for_interviewer: position.notes_for_interviewer,
    skills_calibration: Array.isArray(position.skills_calibration)
      ? position.skills_calibration.map((row) => ({ ...row }))
      : [],
  };
}

export default function Page() {
  const router = useRouter();
  const defaultAgentRoom = 'agent-test-room';

  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [openCandidates, setOpenCandidates] = useState<CandidateProfile[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [candidatePositionById, setCandidatePositionById] = useState<Record<string, string>>({});
  const [candidateScreeningById, setCandidateScreeningById] = useState<Record<string, CandidateScreening | undefined>>({});
  const [ignoredCandidateById, setIgnoredCandidateById] = useState<Record<string, boolean>>({});

  const [selectedPositionId, setSelectedPositionId] = useState('');
  const [positionDraft, setPositionDraft] = useState<PositionConfigCore | null>(null);
  const [isSkillsCalibrationOpen, setIsSkillsCalibrationOpen] = useState(false);
  const [skillsCalibrationDraft, setSkillsCalibrationDraft] = useState<SkillCalibrationItem[]>([]);

  const [editingSetupId, setEditingSetupId] = useState('');
  const [selectedOutcomeId, setSelectedOutcomeId] = useState('');
  const [selectedCvJdInterviewId, setSelectedCvJdInterviewId] = useState('');
  const [setupForm, setSetupForm] = useState<SetupFormState>(() => buildDefaultSetup(defaultAgentRoom));
  const [reportDraft, setReportDraft] = useState<Record<string, string>>({});
  const [agentPromptSettings, setAgentPromptSettings] = useState<AgentPromptSettings>(
    DEFAULT_AGENT_SETTINGS,
  );

  const selectedOutcome = useMemo(
    () => interviews.find((item) => item.id === selectedOutcomeId),
    [interviews, selectedOutcomeId],
  );
  const selectedCvJdInterview = useMemo(
    () => interviews.find((item) => item.id === selectedCvJdInterviewId),
    [interviews, selectedCvJdInterviewId],
  );

  const selectedPosition = useMemo(
    () => positions.find((item) => item.position_id === selectedPositionId),
    [positions, selectedPositionId],
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
  const latestInterviewByApplicationId = useMemo(() => {
    const byId = new Map<string, InterviewRecord>();
    for (const application of applications) {
      const roomName = String(application.roomName || '').trim().toLowerCase();
      const fallbackRoomName = `application-${application.id.slice(0, 8)}`.toLowerCase();
      const candidateKey = candidateKeyFromApplication(application);
      const related = interviews
        .filter((interview) => {
          if (!interviewHasStarted(interview)) return false;
          const interviewRoomName = String(interview.roomName || '').trim().toLowerCase();
          if (interviewRoomName && (interviewRoomName === roomName || interviewRoomName === fallbackRoomName)) {
            return true;
          }
          const interviewCandidateKey = candidateKeyOf(interview);
          return Boolean(candidateKey && interviewCandidateKey && interviewCandidateKey === candidateKey);
        })
        .sort((a, b) => interviewRecencyTimestamp(b) - interviewRecencyTimestamp(a));
      if (related[0]) byId.set(application.id, related[0]);
    }
    return byId;
  }, [applications, interviews]);

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
      const [interviewResult, positionResult, settingsResult, candidateResult, applicationsResult] = await Promise.allSettled([
        fetchJsonWithTimeout('/api/interviews'),
        fetchJsonWithTimeout('/api/positions'),
        fetchJsonWithTimeout('/api/agent-settings'),
        fetchJsonWithTimeout('/api/candidates'),
        fetchJsonWithTimeout('/api/applications'),
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

      if (settingsResult.status === 'fulfilled') {
        const { response, json } = settingsResult.value;
        if (response.ok && json?.ok !== false && json?.settings) {
          setAgentPromptSettings({
            classicPrompt: String(json.settings.classicPrompt || ''),
            realtimePrompt: String(json.settings.realtimePrompt || ''),
            screeningMaxMinutes: Number(json.settings.screeningMaxMinutes ?? 10),
            sttVadRmsThreshold: Number(json.settings.sttVadRmsThreshold ?? 0.0035),
            sttMinSpeechMs: Number(json.settings.sttMinSpeechMs ?? 350),
            sttMaxSilenceMs: Number(json.settings.sttMaxSilenceMs ?? 900),
            sttMaxUtteranceMs: Number(json.settings.sttMaxUtteranceMs ?? 30000),
            sttMinTranscribeMs: Number(json.settings.sttMinTranscribeMs ?? 400),
            sttGraceMs: Number(json.settings.sttGraceMs ?? 350),
            updatedAt: String(json.settings.updatedAt || ''),
          });
        } else {
          errors.push(json?.error || 'Failed to load agent settings');
        }
      } else {
        errors.push('Agent settings request timed out or failed');
      }

      setInterviews(nextInterviews);
      setPositions(nextPositions);
      if (candidateResult.status === 'fulfilled') {
        const { response, json } = candidateResult.value;
        if (response.ok && json?.ok !== false && json?.kind === 'profiles') {
          setOpenCandidates(Array.isArray(json?.candidates) ? json.candidates : []);
        } else {
          setOpenCandidates([]);
          errors.push(json?.error || 'Failed to load candidates');
        }
      } else {
        setOpenCandidates([]);
        errors.push('Candidates request timed out or failed');
      }
      if (applicationsResult.status === 'fulfilled') {
        const { response, json } = applicationsResult.value;
        if (response.ok && json?.ok !== false) {
          setApplications(Array.isArray(json?.applications) ? json.applications : []);
        } else {
          setApplications([]);
          errors.push(json?.error || 'Failed to load applications');
        }
      } else {
        setApplications([]);
        errors.push('Applications request timed out or failed');
      }
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

  const buildApplicationJoinUrl = (
    application: ApplicationRecord,
    role: 'candidate' | 'moderator',
  ) => {
    const roomName = String(application.roomName || '').trim() || `application-${application.id.slice(0, 8)}`;
    const params = new URLSearchParams();
    params.set('autojoin', '1');
    params.set('role', role);
    params.set('name', role === 'candidate' ? application.candidateName || 'Candidate' : 'Moderator');
    if (application.interviewAgentType === 'realtime_screening') {
      params.set('agentType', 'realtime_screening');
    }
    return `/rooms/${encodeURIComponent(roomName)}?${params.toString()}`;
  };

  const copyApplicationRoomLink = async (application: ApplicationRecord) => {
    const relative = buildApplicationJoinUrl(application, 'candidate');
    const absolute = `${window.location.origin}${relative}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setSuccess('Interview room link copied.');
    } catch {
      setError('Failed to copy room link.');
    }
  };

  const updateApplicationAgentType = async (applicationId: string, interviewAgentType: AgentType) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewAgentType }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok || !json?.application) {
        throw new Error(json?.error || 'Failed to update application agent type');
      }
      setApplications((prev) =>
        prev.map((item) => (item.id === applicationId ? (json.application as ApplicationRecord) : item)),
      );
      setSuccess('Application agent type updated.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update application agent type');
    } finally {
      setSaving(false);
    }
  };

  const deleteApplicationById = async (applicationId: string) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/applications/${applicationId}`, {
        method: 'DELETE',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to delete application');
      }
      setApplications((prev) => prev.filter((item) => item.id !== applicationId));
      setSuccess('Application deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete application');
    } finally {
      setSaving(false);
    }
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

  const deletePositionById = async (positionId: string) => {
    if (!positionId) return;
    const confirmed = window.confirm('Delete this position? This cannot be undone.');
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/positions/${positionId}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to delete position');
      }
      setSuccess('Position deleted.');
      if (selectedPositionId === positionId) {
        setSelectedPositionId('');
        setPositionDraft(null);
      }
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete position');
    } finally {
      setSaving(false);
    }
  };

  const deleteInterviewById = async (interviewId: string) => {
    if (!interviewId) return;
    const confirmed = window.confirm('Delete this interview? This cannot be undone.');
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/interviews/${interviewId}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to delete interview');
      }
      setSuccess('Interview deleted.');
      if (selectedOutcomeId === interviewId) {
        setSelectedOutcomeId('');
      }
      if (editingSetupId === interviewId) {
        setEditingSetupId('');
        setSetupForm(buildDefaultSetup(defaultAgentRoom));
      }
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete interview');
    } finally {
      setSaving(false);
    }
  };

  const openSkillsCalibration = (position: PositionRecord) => {
    setSelectedPositionId(position.position_id);
    const draft = clonePosition(position);
    setPositionDraft(draft);
    setSkillsCalibrationDraft(buildSkillCalibrationDraft(draft));
    setIsSkillsCalibrationOpen(true);
  };

  const saveSkillsCalibration = async () => {
    if (!selectedPosition || !positionDraft) return;
    const normalizedRows = normalizeSkillCalibration(skillsCalibrationDraft);
    const mustHaves = normalizedRows
      .filter((row) => row.category === 'must_have')
      .map((row) => row.skill)
      .slice(0, 8);
    const niceToHaves = normalizedRows
      .filter((row) => row.category === 'nice_to_have')
      .map((row) => row.skill)
      .slice(0, 8);
    const nextConfig: PositionConfigCore = {
      ...positionDraft,
      must_haves: mustHaves,
      nice_to_haves: niceToHaves,
      skills_calibration: normalizedRows,
    };

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/positions/${selectedPosition.position_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalConfig: nextConfig }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Failed to save skill calibration');
      }
      setPositionDraft(clonePosition(nextConfig));
      setSuccess('Skill calibration updated.');
      setIsSkillsCalibrationOpen(false);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save skill calibration');
    } finally {
      setSaving(false);
    }
  };

  const saveAgentPromptSettings = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/agent-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classicPrompt: agentPromptSettings.classicPrompt,
          realtimePrompt: agentPromptSettings.realtimePrompt,
          screeningMaxMinutes: agentPromptSettings.screeningMaxMinutes,
          sttVadRmsThreshold: agentPromptSettings.sttVadRmsThreshold,
          sttMinSpeechMs: agentPromptSettings.sttMinSpeechMs,
          sttMaxSilenceMs: agentPromptSettings.sttMaxSilenceMs,
          sttMaxUtteranceMs: agentPromptSettings.sttMaxUtteranceMs,
          sttMinTranscribeMs: agentPromptSettings.sttMinTranscribeMs,
          sttGraceMs: agentPromptSettings.sttGraceMs,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.settings) {
        throw new Error(json?.error || 'Failed to save agent settings');
      }
      setAgentPromptSettings({
        classicPrompt: String(json.settings.classicPrompt || ''),
        realtimePrompt: String(json.settings.realtimePrompt || ''),
        screeningMaxMinutes: Number(json.settings.screeningMaxMinutes ?? 10),
        sttVadRmsThreshold: Number(json.settings.sttVadRmsThreshold ?? 0.0035),
        sttMinSpeechMs: Number(json.settings.sttMinSpeechMs ?? 350),
        sttMaxSilenceMs: Number(json.settings.sttMaxSilenceMs ?? 900),
        sttMaxUtteranceMs: Number(json.settings.sttMaxUtteranceMs ?? 30000),
        sttMinTranscribeMs: Number(json.settings.sttMinTranscribeMs ?? 400),
        sttGraceMs: Number(json.settings.sttGraceMs ?? 350),
        updatedAt: String(json.settings.updatedAt || ''),
      });
      setSuccess('Agent prompt settings updated. New interviews will use these defaults.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save agent settings');
    } finally {
      setSaving(false);
    }
  };

  const screenOpenCandidate = async (candidateId: string) => {
    const positionId = String(candidatePositionById[candidateId] || positions[0]?.position_id || '').trim();
    if (!candidateId || !positionId) {
      setError('Select a position before screening.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/candidates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'screen', candidateId, positionId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok || !json?.screening) {
        throw new Error(json?.error || 'Failed to screen candidate');
      }
      setCandidateScreeningById((prev) => ({
        ...prev,
        [candidateId]: json.screening as CandidateScreening,
      }));
      setSuccess('Screening completed. Review and create or ignore application.');
    } catch (screenError) {
      setError(screenError instanceof Error ? screenError.message : 'Failed to screen candidate');
    } finally {
      setSaving(false);
    }
  };

  const createApplicationFromScreening = async (candidateId: string) => {
    const positionId = String(candidatePositionById[candidateId] || positions[0]?.position_id || '').trim();
    if (!positionId) {
      setError('Select a position before creating application.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/candidates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', candidateId, positionId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to create application');
      }
      const created = (json?.candidate || null) as ApplicationRecord | null;
      if (created?.id) {
        setApplications((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      }
      switchTab('applications');
      setSuccess('Application created from stored screening.');
      setCandidateScreeningById((prev) => ({ ...prev, [candidateId]: undefined }));
      void loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create application');
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
                <div className={styles.heroOrb}>
                  <img src="/images/chameleon.png" alt="" className={styles.heroOrbImage} />
                </div>
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
            <button type="button" className="lk-button" aria-pressed={activeTab === 'candidates'} onClick={() => switchTab('candidates')}>
              Candidates
            </button>
            <button type="button" className="lk-button" aria-pressed={activeTab === 'applications'} onClick={() => switchTab('applications')}>
              Applications
            </button>
            <button type="button" className="lk-button" aria-pressed={activeTab === 'interviews'} onClick={() => switchTab('interviews')}>
              Interviews
            </button>
            <button type="button" className="lk-button" aria-pressed={activeTab === 'settings'} onClick={() => switchTab('settings')}>
              Settings
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
                      <span>{formatScoreTag(item.cvJdScorecard)}</span>
                    </div>
                    <div className={styles.cardButtons}>
                      <button type="button" className="lk-button" onClick={() => router.push(buildInterviewJoinUrl(item))}>
                        Join
                      </button>
                      <button type="button" className="lk-button" onClick={() => setSelectedCvJdInterviewId(item.id)}>
                        View CV-JD Score
                      </button>
                      <button type="button" className="lk-button" onClick={() => openOutcome(item.id)}>
                        View details
                      </button>
                      {item.status === 'completed' ? (
                        <a
                          className="lk-button"
                          href={`/api/interviews/${item.id}/download?kind=report`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download Report
                        </a>
                      ) : null}
                      {item.status === 'completed' ? (
                        <a
                          className="lk-button"
                          href={`/api/interviews/${item.id}/download?kind=transcript`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download Transcript
                        </a>
                      ) : null}
                      {item.status === 'completed' && String(item.recordingUrl || '').trim() ? (
                        <a
                          className="lk-button"
                          href={`/api/interviews/${item.id}/download?kind=recording`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download Recording
                        </a>
                      ) : null}
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
                <button type="button" className="lk-button" onClick={() => router.push('/positions/new')}>
                  New Position Setup
                </button>
              </div>

              {positions.length === 0 ? <p>No positions found. Create one from New Position Setup.</p> : null}
              {positions.length > 0 ? (
                <div className={styles.interviewList}>
                  {positions.map((position) => (
                    <div key={position.position_id} className={styles.reportPanel}>
                      <h4 style={{ marginTop: 0 }}>{position.role_title}</h4>
                      <p className={styles.interviewMeta}>{position.notes_for_interviewer || 'No JD notes saved for this position.'}</p>
                      <p className={styles.interviewMeta}>{`Level: ${position.level} | Duration: ${position.duration_minutes}m`}</p>
                      <p className={styles.interviewMeta}>{`Focus areas: ${position.focus_areas.join(', ') || 'None'}`}</p>
                      <p className={styles.interviewMeta}>
                        {`Must-haves: ${position.must_haves.join(', ') || 'None'} | Nice-to-haves: ${
                          position.nice_to_haves.join(', ') || 'None'
                        }`}
                      </p>
                      <p className={styles.interviewMeta}>{`Tech stack: ${position.tech_stack.join(', ') || 'None'}`}</p>
                      <p className={styles.interviewMeta}>
                        {`Scorecard policy: ${position.evaluation_policy} | Strictness: ${position.strictness}`}
                      </p>
                      <div className={styles.cardButtons}>
                        <button
                          type="button"
                          className="lk-button"
                          onClick={() => router.push(`/positions/new?positionId=${encodeURIComponent(position.position_id)}`)}
                        >
                          Edit Position
                        </button>
                        <button type="button" className="lk-button" onClick={() => openSkillsCalibration(position)}>
                          Manage Skills Calibration
                        </button>
                        <button
                          type="button"
                          className="lk-button"
                          onClick={() => deletePositionById(position.position_id)}
                          disabled={saving}
                        >
                          Delete Position
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && activeTab === 'candidates' ? (
            <div className={styles.tabContent}>
              <div className={styles.cardButtons}>
                <button type="button" className="lk-button" onClick={() => router.push('/candidates')}>
                  New Candidate
                </button>
              </div>

              {openCandidates.filter((candidate) => !ignoredCandidateById[candidate.id]).length === 0 ? <p>No open candidates found.</p> : null}
              {openCandidates.length > 0 ? (
                <div className={styles.interviewList}>
                  {openCandidates
                    .filter((candidate) => !ignoredCandidateById[candidate.id])
                    .map((candidate) => (
                    <div key={candidate.id} className={styles.reportPanel}>
                      <h4 style={{ marginTop: 0 }}>{candidate.fullName || 'Unknown Candidate'}</h4>
                      <p className={styles.interviewMeta}>{candidate.email || 'Email not provided'}</p>
                      <p className={styles.interviewMeta}>{candidate.currentTitle || 'Title not provided'}</p>
                      <p className={styles.interviewMeta}>{candidate.yearsExperience || 'Experience not provided'}</p>
                      <p className={styles.interviewMeta}>
                        {Array.isArray(candidate.keySkills) && candidate.keySkills.length > 0
                          ? candidate.keySkills.join(', ')
                          : 'Skills not provided'}
                      </p>
                      {String(candidate.candidateContext || '').trim() ? (
                        <p className={styles.interviewMeta}>{candidate.candidateContext}</p>
                      ) : null}
                      <p className={styles.interviewMeta}>{`Updated: ${formatDate(candidate.updatedAt)}`}</p>
                      <label className={styles.formField}>
                        <span className={styles.formFieldLabel}>Screen Against Position</span>
                        <select
                          value={candidatePositionById[candidate.id] || positions[0]?.position_id || ''}
                          onChange={(e) =>
                            setCandidatePositionById((prev) => ({ ...prev, [candidate.id]: e.target.value }))
                          }
                        >
                          {positions.map((position) => (
                            <option key={position.position_id} value={position.position_id}>
                              {position.role_title} ({position.level})
                            </option>
                          ))}
                        </select>
                      </label>
                      {candidateScreeningById[candidate.id] ? (
                        <p className={styles.interviewMeta}>
                          {`Screening: ${
                            candidateScreeningById[candidate.id]?.blendedRecommendation?.toUpperCase() ||
                            candidateScreeningById[candidate.id]?.recommendation.toUpperCase()
                          } | Blended ${
                            candidateScreeningById[candidate.id]?.blendedScore ??
                            candidateScreeningById[candidate.id]?.cvJdScorecard?.overallScore ??
                            0
                          }/100`}
                        </p>
                      ) : null}
                      <div className={styles.cardButtons}>
                        <button type="button" className="lk-button" onClick={() => screenOpenCandidate(candidate.id)} disabled={saving}>
                          Screen
                        </button>
                        <button
                          type="button"
                          className="lk-button"
                          onClick={() => {
                            const positionId = String(candidatePositionById[candidate.id] || positions[0]?.position_id || '').trim();
                            if (!positionId) {
                              setError('Select a position first.');
                              return;
                            }
                            const url = `/candidates/screening?candidateId=${encodeURIComponent(candidate.id)}&positionId=${encodeURIComponent(positionId)}`;
                            window.open(url, 'candidate-screening', 'width=1040,height=820');
                          }}
                          disabled={saving}
                        >
                          View Screening Details
                        </button>
                        <button
                          type="button"
                          className="lk-button"
                          onClick={() => createApplicationFromScreening(candidate.id)}
                          disabled={saving}
                        >
                          Create Application
                        </button>
                        <button
                          type="button"
                          className="lk-button"
                          onClick={() => setIgnoredCandidateById((prev) => ({ ...prev, [candidate.id]: true }))}
                          disabled={saving}
                        >
                          Ignore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && activeTab === 'applications' ? (
            <div className={styles.tabContent}>
              <h3 style={{ margin: 0 }}>Applications</h3>
              {applications.length === 0 ? <p>No applications found.</p> : null}
              {applications.length > 0 ? (
                <div className={styles.interviewList}>
                  {applications.map((application) => {
                    const position = positions.find((item) => item.position_id === application.positionId);
                    const latestInterview = latestInterviewByApplicationId.get(application.id);
                    const screeningScore =
                      Number(application.blendedScore || 0) > 0
                        ? Number(application.blendedScore || 0)
                        : 0;
                    return (
                      <div key={application.id} className={styles.reportPanel}>
                        <h4 style={{ marginTop: 0 }}>{application.candidateName || 'Unknown Candidate'}</h4>
                        <p className={styles.interviewMeta}>{application.candidateEmail || 'Email not provided'}</p>
                        <p className={styles.interviewMeta}>{`Position: ${position?.role_title || application.positionId}`}</p>
                        <p className={styles.interviewMeta}>{`Screening score: ${screeningScore}/100`}</p>
                        <p className={styles.interviewMeta}>{`Recommendation: ${(application.blendedRecommendation || application.recommendation || 'reject').toUpperCase()}`}</p>
                        <p className={styles.interviewMeta}>{`Room: ${application.roomName || `application-${application.id.slice(0, 8)}`}`}</p>
                        <p className={styles.interviewMeta}>
                          {latestInterview ? `Interview artifacts available (latest: ${formatDate(latestInterview.updatedAt)})` : 'No completed/started interview artifacts yet.'}
                        </p>
                        <label className={styles.formField}>
                          <span className={styles.formFieldLabel}>Interview Agent Type</span>
                          <select
                            value={application.interviewAgentType || 'classic'}
                            onChange={(e) =>
                              void updateApplicationAgentType(
                                application.id,
                                e.target.value === 'realtime_screening' ? 'realtime_screening' : 'classic',
                              )
                            }
                            disabled={saving}
                          >
                            <option value="classic">Classic</option>
                            <option value="realtime_screening">Realtime Screening</option>
                          </select>
                        </label>
                        <div className={styles.cardButtons}>
                          <button
                            type="button"
                            className="lk-button"
                            onClick={() => router.push(buildApplicationJoinUrl(application, 'candidate'))}
                          >
                            Join as Candidate
                          </button>
                          <button
                            type="button"
                            className="lk-button"
                            onClick={() => router.push(buildApplicationJoinUrl(application, 'moderator'))}
                          >
                            Join as Moderator
                          </button>
                          <button type="button" className="lk-button" onClick={() => void copyApplicationRoomLink(application)}>
                            Copy Interview Room Link
                          </button>
                          {latestInterview ? (
                            <button type="button" className="lk-button" onClick={() => openOutcome(latestInterview.id)}>
                              View Outcomes
                            </button>
                          ) : null}
                          {latestInterview ? (
                            <a
                              className="lk-button"
                              href={`/api/interviews/${latestInterview.id}/download?kind=report`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download Report
                            </a>
                          ) : null}
                          {latestInterview ? (
                            <a
                              className="lk-button"
                              href={`/api/interviews/${latestInterview.id}/download?kind=transcript`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download Transcript
                            </a>
                          ) : null}
                          {latestInterview && String(latestInterview.recordingUrl || '').trim() ? (
                            <a
                              className="lk-button"
                              href={`/api/interviews/${latestInterview.id}/download?kind=recording`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download Recording
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="lk-button"
                            onClick={() => void deleteApplicationById(application.id)}
                            disabled={saving}
                          >
                            Delete Application
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && activeTab === 'interviews' ? (
            <div className={styles.tabContent}>
              <h3 style={{ margin: 0 }}>{editingSetupId ? 'Edit Interview Setup' : 'Interview Room Setup'}</h3>
              <form onSubmit={handleSetupSubmit} className={styles.formGrid}>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Candidate Name*</span>
                  <input
                    value={setupForm.candidateName}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, candidateName: e.target.value }))}
                    placeholder="Candidate Name"
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Candidate Email*</span>
                  <input
                    value={setupForm.candidateEmail}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, candidateEmail: e.target.value }))}
                    type="email"
                    placeholder="Candidate Email"
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Interviewer Name*</span>
                  <input
                    value={setupForm.interviewerName}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, interviewerName: e.target.value }))}
                    placeholder="Interviewer Name"
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Interviewer Email</span>
                  <input
                    value={setupForm.interviewerEmail}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, interviewerEmail: e.target.value }))}
                    type="email"
                    placeholder="Interviewer Email"
                  />
                </label>

                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Open Position*</span>
                  <select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)} required>
                    <option value="">Select Open Position</option>
                    {positions.map((position) => (
                      <option key={position.position_id} value={position.position_id}>
                        {position.role_title} ({position.level})
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Department / Function</span>
                  <input
                    value={setupForm.jobDepartment}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, jobDepartment: e.target.value }))}
                    placeholder="Department / Function"
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Scheduled Date*</span>
                  <input
                    type="date"
                    value={setupForm.scheduledDate}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, scheduledDate: e.target.value }))}
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Scheduled Time*</span>
                  <input
                    type="time"
                    step={60}
                    value={setupForm.scheduledTime}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, scheduledTime: e.target.value }))}
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Timezone*</span>
                  <input
                    type="text"
                    value={setupForm.timezone}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, timezone: e.target.value }))}
                    placeholder="Timezone"
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Room Name*</span>
                  <input
                    type="text"
                    value={setupForm.roomName}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, roomName: e.target.value }))}
                    placeholder="Room Name"
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Interview Agent</span>
                  <select
                    value={setupForm.agentType}
                    onChange={(e) =>
                      setSetupForm((prev) => ({ ...prev, agentType: e.target.value as AgentType }))
                    }
                  >
                    <option value="classic">Classic Interview Agent</option>
                    <option value="realtime_screening">Realtime Screening Agent (10 min)</option>
                  </select>
                </label>

                {positionDraft ? (
                  <>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Position Title</span>
                      <input
                        value={positionDraft.role_title}
                        onChange={(e) => setPositionDraft((prev) => (prev ? { ...prev, role_title: e.target.value } : prev))}
                        placeholder="Job Title"
                        required
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Level</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Interview Duration (minutes)</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Deep Dive Mode</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Strictness</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Evaluation Policy</span>
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
                    </label>

                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Must Haves</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Nice to Haves</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Tech Stack</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Focus Areas</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Position Notes For Interviewer</span>
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
                    </label>
                  </>
                ) : null}

                {!editingSetupId ? (
                  <label className={styles.fileLabel}>
                    Candidate CV
                    <input id="candidateCv" type="file" accept=".pdf,.doc,.docx,.txt" />
                  </label>
                ) : null}

                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Additional Setup Notes / Constraints</span>
                  <textarea
                    rows={3}
                    value={setupForm.notes}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional setup notes / constraints"
                  />
                </label>

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
                      <span>{formatScoreTag(item.cvJdScorecard)}</span>
                    </div>
                    <div className={styles.cardButtons}>
                      <button type="button" className="lk-button" onClick={() => startEditInterview(item)}>
                        Edit setup
                      </button>
                      <button type="button" className="lk-button" onClick={() => router.push(buildInterviewJoinUrl(item))}>
                        Join
                      </button>
                      <button type="button" className="lk-button" onClick={() => setSelectedCvJdInterviewId(item.id)}>
                        View CV-JD Score
                      </button>
                      <button type="button" className="lk-button" onClick={() => openOutcome(item.id)}>
                        View outcomes
                      </button>
                      {item.status === 'completed' ? (
                        <a
                          className="lk-button"
                          href={`/api/interviews/${item.id}/download?kind=report`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download Report
                        </a>
                      ) : null}
                      {item.status === 'completed' ? (
                        <a
                          className="lk-button"
                          href={`/api/interviews/${item.id}/download?kind=transcript`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download Transcript
                        </a>
                      ) : null}
                      {item.status === 'completed' && String(item.recordingUrl || '').trim() ? (
                        <a
                          className="lk-button"
                          href={`/api/interviews/${item.id}/download?kind=recording`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download Recording
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="lk-button"
                        onClick={() => deleteInterviewById(item.id)}
                        disabled={saving}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {selectedOutcome ? (
                <div className={styles.reportPanel}>
                  <h4 style={{ marginTop: 0 }}>{`Interview Output: ${selectedOutcome.candidateName}`}</h4>
                  <div className={styles.reportGrid}>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Interview Status</span>
                      <select
                        value={reportDraft.status ?? ''}
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, status: e.target.value }))}
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Actual Start</span>
                      <input
                        type="datetime-local"
                        value={reportDraft.meetingActualStart ?? ''}
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, meetingActualStart: e.target.value }))}
                        title="Actual start"
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Actual End</span>
                      <input
                        type="datetime-local"
                        value={reportDraft.meetingActualEnd ?? ''}
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, meetingActualEnd: e.target.value }))}
                        title="Actual end"
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Recording URL</span>
                      <input
                        value={reportDraft.recordingUrl ?? ''}
                        placeholder="Recording URL (S3/http)"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, recordingUrl: e.target.value }))}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Rubric Score (0-10)</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={reportDraft.rubricScore ?? ''}
                        placeholder="Rubric Score (0-10)"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, rubricScore: e.target.value }))}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Interview Score (0-100)</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={reportDraft.interviewScore ?? ''}
                        placeholder="Interview Score (0-100)"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, interviewScore: e.target.value }))}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Recommendation</span>
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
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Participants Joined</span>
                      <textarea
                        rows={2}
                        value={reportDraft.participantsJoined ?? ''}
                        placeholder="Participants joined (names/emails)"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, participantsJoined: e.target.value }))}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Summary Interview Feedback</span>
                      <textarea
                        rows={3}
                        value={reportDraft.summaryFeedback ?? ''}
                        placeholder="Summary interview feedback"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, summaryFeedback: e.target.value }))}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Detailed Interview Feedback</span>
                      <textarea
                        rows={5}
                        value={reportDraft.detailedFeedback ?? ''}
                        placeholder="Detailed interview feedback"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, detailedFeedback: e.target.value }))}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.formFieldLabel}>Next Steps</span>
                      <textarea
                        rows={3}
                        value={reportDraft.nextSteps ?? ''}
                        placeholder="Recommendation rationale / next steps"
                        onChange={(e) => setReportDraft((prev) => ({ ...prev, nextSteps: e.target.value }))}
                      />
                    </label>
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
                    <a
                      href={`/api/interviews/${selectedOutcome.id}/download?kind=report`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download Evaluation Report
                    </a>
                    <a
                      href={`/api/interviews/${selectedOutcome.id}/download?kind=transcript`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download Transcript
                    </a>
                    {String(selectedOutcome.recordingUrl || '').trim() ? (
                      <a
                        href={`/api/interviews/${selectedOutcome.id}/download?kind=recording`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download Recording
                      </a>
                    ) : (
                      <button
                        type="button"
                        className={styles.assetDisabledButton}
                        disabled
                        title="Interview was not recorded"
                      >
                        Download Recording
                      </button>
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

          {!loading && activeTab === 'settings' ? (
            <div className={styles.tabContent}>
              <div className={styles.cardButtons}>
                <button type="button" className="lk-button" onClick={() => router.push('/canonicalizations')}>
                  Canonicalizations
                </button>
              </div>
              <h3 style={{ margin: 0 }}>Agent Prompt Settings</h3>
              <p className={styles.interviewMeta}>
                Edit the base runtime context for each agent. Candidate CV and role context are still appended automatically at runtime.
              </p>
              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Screening Time Limit (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={agentPromptSettings.screeningMaxMinutes}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        screeningMaxMinutes: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>VAD RMS Threshold</span>
                  <input
                    type="number"
                    min={0.0001}
                    max={0.1}
                    step={0.0001}
                    value={agentPromptSettings.sttVadRmsThreshold}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        sttVadRmsThreshold: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Min Speech (ms)</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={agentPromptSettings.sttMinSpeechMs}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        sttMinSpeechMs: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Max Silence (ms)</span>
                  <input
                    type="number"
                    min={100}
                    max={20000}
                    value={agentPromptSettings.sttMaxSilenceMs}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        sttMaxSilenceMs: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Max Utterance (ms)</span>
                  <input
                    type="number"
                    min={1000}
                    max={120000}
                    value={agentPromptSettings.sttMaxUtteranceMs}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        sttMaxUtteranceMs: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Min Transcribe (ms)</span>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    value={agentPromptSettings.sttMinTranscribeMs}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        sttMinTranscribeMs: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.formFieldLabel}>Turn-End Grace (ms)</span>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={agentPromptSettings.sttGraceMs}
                    onChange={(e) =>
                      setAgentPromptSettings((prev) => ({
                        ...prev,
                        sttGraceMs: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
              </div>
              <label className={styles.formField}>
                <span className={styles.formFieldLabel}>Classic Interview Agent Prompt</span>
                <textarea
                  className={styles.settingsTextArea}
                  value={agentPromptSettings.classicPrompt}
                  onChange={(e) =>
                    setAgentPromptSettings((prev) => ({ ...prev, classicPrompt: e.target.value }))
                  }
                  placeholder="Enter base prompt for classic agent"
                />
              </label>
              <label className={styles.formField}>
                <span className={styles.formFieldLabel}>Realtime Screening Agent Prompt</span>
                <textarea
                  className={styles.settingsTextArea}
                  value={agentPromptSettings.realtimePrompt}
                  onChange={(e) =>
                    setAgentPromptSettings((prev) => ({ ...prev, realtimePrompt: e.target.value }))
                  }
                  placeholder="Enter base prompt for realtime screening agent"
                />
              </label>
              <div className={styles.cardButtons}>
                <button type="button" className="lk-button" onClick={saveAgentPromptSettings} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
                <button type="button" className="lk-button" onClick={() => loadData()} disabled={saving}>
                  Reload
                </button>
              </div>
              <p className={styles.interviewMeta}>
                {agentPromptSettings.updatedAt
                  ? `Last updated: ${formatDate(agentPromptSettings.updatedAt)}`
                  : 'Using default prompt settings.'}
              </p>
            </div>
          ) : null}
        </div>
      </main>
      {selectedCvJdInterview ? (
        <div className={styles.scoreSheetBackdrop} role="presentation" onClick={() => setSelectedCvJdInterviewId('')}>
          <div className={styles.scoreSheet} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.scoreSheetHeader}>
              <h3 style={{ margin: 0 }}>{`CV vs JD Skill Match: ${selectedCvJdInterview.candidateName}`}</h3>
              <button type="button" className="lk-button" onClick={() => setSelectedCvJdInterviewId('')}>
                Close
              </button>
            </div>
            {selectedCvJdInterview.cvJdScorecard ? (
              <>
                <div className={styles.scoreSummaryGrid}>
                  <div className={styles.scorePill}>
                    <span>Overall</span>
                    <strong>{`${selectedCvJdInterview.cvJdScorecard.overallScore}/100`}</strong>
                  </div>
                  <div className={styles.scorePill}>
                    <span>Must-have</span>
                    <strong>{`${selectedCvJdInterview.cvJdScorecard.mustHaveScore}/100`}</strong>
                  </div>
                  <div className={styles.scorePill}>
                    <span>Common</span>
                    <strong>{`${selectedCvJdInterview.cvJdScorecard.commonSkillScore}/100`}</strong>
                  </div>
                </div>
                <p className={styles.interviewMeta}>{selectedCvJdInterview.cvJdScorecard.summary}</p>

                <h4 style={{ marginBottom: 0 }}>Must-have Skills</h4>
                {selectedCvJdInterview.cvJdScorecard.details.filter((x) => x.category === 'must_have').length === 0 ? (
                  <p className={styles.interviewMeta}>No must-have skills defined on this JD.</p>
                ) : (
                  <div className={styles.scoreTable}>
                    {selectedCvJdInterview.cvJdScorecard.details
                      .filter((x) => x.category === 'must_have')
                      .map((item) => (
                        <div key={`must-${item.skill}`} className={styles.scoreRow}>
                          <span className={styles.scoreSkill}>{item.skill}</span>
                          <span className={styles.scoreMatch}>{item.matched ? `Match (${item.score})` : 'Gap (0)'}</span>
                          <span className={styles.scoreEvidence}>{item.oneLiner}</span>
                        </div>
                      ))}
                  </div>
                )}

                <h4 style={{ marginBottom: 0 }}>Common Skills</h4>
                {selectedCvJdInterview.cvJdScorecard.details.filter((x) => x.category === 'common').length === 0 ? (
                  <p className={styles.interviewMeta}>No common skills defined on this JD.</p>
                ) : (
                  <div className={styles.scoreTable}>
                    {selectedCvJdInterview.cvJdScorecard.details
                      .filter((x) => x.category === 'common')
                      .map((item) => (
                        <div key={`common-${item.skill}`} className={styles.scoreRow}>
                          <span className={styles.scoreSkill}>{item.skill}</span>
                          <span className={styles.scoreMatch}>{item.matched ? `Match (${item.score})` : 'Gap (0)'}</span>
                          <span className={styles.scoreEvidence}>{item.oneLiner}</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <p className={styles.interviewMeta}>
                Score unavailable. Upload CV and ensure JD has must-have/common skills.
              </p>
            )}
          </div>
        </div>
      ) : null}
      {isSkillsCalibrationOpen ? (
        <div className={styles.scoreSheetBackdrop} role="presentation" onClick={() => setIsSkillsCalibrationOpen(false)}>
          <div className={styles.scoreSheet} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.scoreSheetHeader}>
              <h3 style={{ margin: 0 }}>Manage Skills Calibration</h3>
              <button type="button" className="lk-button" onClick={() => setIsSkillsCalibrationOpen(false)}>
                Close
              </button>
            </div>
            <p className={styles.interviewMeta}>
              Set must-have and nice-to-have skill rows, one-line definition, and weightage.
            </p>
            <div className={styles.scoreTable}>
              {skillsCalibrationDraft.map((row, idx) => (
                <div key={`${row.skill}-${idx}`} className={styles.calibrationRow}>
                  <input
                    value={row.skill}
                    placeholder="Skill"
                    onChange={(e) =>
                      setSkillsCalibrationDraft((prev) =>
                        prev.map((item, itemIdx) =>
                          itemIdx === idx ? { ...item, skill: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <select
                    value={row.category}
                    onChange={(e) =>
                      setSkillsCalibrationDraft((prev) =>
                        prev.map((item, itemIdx) =>
                          itemIdx === idx
                            ? {
                                ...item,
                                category:
                                  e.target.value === 'nice_to_have' ? 'nice_to_have' : 'must_have',
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="must_have">Must Have</option>
                    <option value="nice_to_have">Nice To Have</option>
                  </select>
                  <input
                    value={row.definition}
                    placeholder="One-line definition"
                    onChange={(e) =>
                      setSkillsCalibrationDraft((prev) =>
                        prev.map((item, itemIdx) =>
                          itemIdx === idx ? { ...item, definition: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <div className={styles.weightControl}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.max(0, Math.min(100, Math.round(row.weight_percent || 0)))}
                      onChange={(e) =>
                        setSkillsCalibrationDraft((prev) =>
                          prev.map((item, itemIdx) =>
                            itemIdx === idx
                              ? { ...item, weight_percent: Number(e.target.value) }
                              : item,
                          ),
                        )
                      }
                    />
                    <span>{`${Math.max(0, Math.min(100, Math.round(row.weight_percent || 0)))}%`}</span>
                  </div>
                  <button
                    type="button"
                    className="lk-button"
                    onClick={() =>
                      setSkillsCalibrationDraft((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.cardButtons}>
              <button
                type="button"
                className="lk-button"
                onClick={() =>
                  setSkillsCalibrationDraft((prev) => [
                    ...prev,
                    { skill: '', category: 'must_have', definition: '', weight_percent: 60 },
                  ])
                }
              >
                Add Skill
              </button>
              <button type="button" className="lk-button" onClick={saveSkillsCalibration} disabled={saving}>
                {saving ? 'Saving...' : 'Save Calibration'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <footer data-lk-theme="default">
        Bristlecone Technical Interaction helps hiring teams run consistent, high-signal technical
        screening interviews.
      </footer>
    </>
  );
}
