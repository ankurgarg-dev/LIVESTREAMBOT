import { randomUUID } from 'crypto';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getPrismaClient } from '@/lib/server/prismaClient';

export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled';
export type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | '';
export type InterviewAgentType = 'classic' | 'realtime_screening';
export type AssessmentDecision = 'strong_hire' | 'hire' | 'lean_hire' | 'lean_no' | 'no_hire';
export type AssessmentConfidence = 'high' | 'medium' | 'low';
export type OverallSignal = 'strong' | 'moderate' | 'weak';

export type CompetencyAssessment = {
  name: string;
  score: number;
  evidence: string;
  strengths: string[];
  concerns: string[];
};

export type EnhancedAssessmentReport = {
  executiveSummary: string;
  overallSignal: OverallSignal;
  recommendationDecision: AssessmentDecision;
  confidence: AssessmentConfidence;
  rationale: string[];
  interviewScore: number;
  rubricScore: number;
  scoreImplication: string;
  calibrationNote: string;
  competencies: CompetencyAssessment[];
  strengths: string[];
  risks: string[];
  followUpQuestions: string[];
  nextSteps: string[];
  evidenceLimitations?: string;
};

export type InterviewAssetMeta = {
  originalName: string;
  storedName: string;
  contentType: string;
  size: number;
};

export type InterviewPositionSnapshot = {
  role_title: string;
  role_family: string;
  level: string;
  interview_round_type: string;
  archetype_id: string;
  duration_minutes: number;
  must_haves: string[];
  nice_to_haves: string[];
  tech_stack: string[];
  focus_areas: string[];
  deep_dive_mode: string;
  strictness: string;
  evaluation_policy: string;
  notes_for_interviewer: string;
};

export type InterviewRecord = {
  id: string;
  status: InterviewStatus;
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
  agentType: InterviewAgentType;
  candidateContext?: string;
  roleContext?: string;
  positionId?: string;
  positionSnapshot?: InterviewPositionSnapshot;
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
  assessmentReport?: EnhancedAssessmentReport;
  createdAt: string;
  updatedAt: string;
};

export type InterviewCreateInput = {
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
  agentType?: InterviewAgentType;
  candidateContext?: string;
  roleContext?: string;
  positionId?: string;
  positionSnapshot?: InterviewPositionSnapshot;
};

export type InterviewUpdateInput = Partial<
  Pick<
    InterviewRecord,
    | 'status'
    | 'meetingActualStart'
    | 'meetingActualEnd'
    | 'participantsJoined'
    | 'recordingUrl'
    | 'rubricScore'
    | 'interviewScore'
    | 'recommendation'
    | 'summaryFeedback'
    | 'detailedFeedback'
    | 'nextSteps'
    | 'agentType'
    | 'transcriptText'
    | 'assessmentReport'
    | 'candidateContext'
    | 'roleContext'
  >
>;

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

const baseDir =
  process.env.INTERVIEW_DATA_DIR ?? path.join(os.homedir(), '.bristlecone-data', 'interviews');
const uploadsDir = path.join(baseDir, 'uploads');

async function ensureStoreDirs() {
  await mkdir(uploadsDir, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function asInterviewRecord(value: unknown): InterviewRecord | null {
  if (!value || typeof value !== 'object') return null;
  const typed = value as InterviewRecord;
  return {
    ...typed,
    agentType: typed.agentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
  };
}

export async function listInterviews(): Promise<InterviewRecord[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.interview.findMany({ orderBy: { createdAt: 'desc' } });
  return rows
    .map((row: { payload: unknown }) => asInterviewRecord(row.payload))
    .filter((item: InterviewRecord | null): item is InterviewRecord => Boolean(item));
}

export async function getInterview(id: string): Promise<InterviewRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.interview.findUnique({ where: { id } });
  const parsed = asInterviewRecord(row?.payload);
  return parsed ?? undefined;
}

export async function getLatestInterviewByRoom(roomName: string): Promise<InterviewRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.interview.findFirst({
    where: { roomName },
    orderBy: { updatedAt: 'desc' },
  });
  const parsed = asInterviewRecord(row?.payload);
  return parsed ?? undefined;
}

export async function createInterview(input: InterviewCreateInput): Promise<InterviewRecord> {
  const prisma = getPrismaClient();
  const now = new Date().toISOString();
  const interview: InterviewRecord = {
    id: randomUUID(),
    status: 'scheduled',
    roomName: input.roomName,
    candidateName: input.candidateName,
    candidateEmail: input.candidateEmail,
    interviewerName: input.interviewerName,
    interviewerEmail: input.interviewerEmail,
    jobTitle: input.jobTitle,
    jobDepartment: input.jobDepartment,
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
    notes: input.notes,
    agentType: input.agentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
    candidateContext: input.candidateContext,
    roleContext: input.roleContext,
    positionId: input.positionId,
    positionSnapshot: input.positionSnapshot,
    createdAt: now,
    updatedAt: now,
  };
  await prisma.interview.create({
    data: {
      id: interview.id,
      roomName: interview.roomName,
      candidateName: interview.candidateName,
      status: interview.status,
      agentType: interview.agentType,
      createdAt: new Date(interview.createdAt),
      updatedAt: new Date(interview.updatedAt),
      payload: interview,
    },
  });
  return interview;
}

export async function updateInterview(id: string, updates: InterviewUpdateInput): Promise<InterviewRecord> {
  const prisma = getPrismaClient();
  const row = await prisma.interview.findUnique({ where: { id } });
  const current = asInterviewRecord(row?.payload);
  if (!current) throw new Error('Interview not found');
  const next: InterviewRecord = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await prisma.interview.update({
    where: { id },
    data: {
      roomName: next.roomName,
      candidateName: next.candidateName,
      status: next.status,
      agentType: next.agentType,
      updatedAt: new Date(next.updatedAt),
      payload: next,
    },
  });
  return next;
}

export async function attachInterviewAsset(
  id: string,
  kind: 'cv' | 'jd',
  file: UploadedFile,
): Promise<InterviewRecord> {
  if (!(file && typeof file.arrayBuffer === 'function' && file.size > 0)) {
    throw new Error(`Missing ${kind.toUpperCase()} file`);
  }

  const current = await getInterview(id);
  if (!current) throw new Error('Interview not found');

  await ensureStoreDirs();
  const safeOriginal = sanitizeFilename(file.name || `${kind}.bin`);
  const storedName = `${id}_${kind}_${Date.now()}_${safeOriginal}`;
  const filePath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const previous = current[kind];
  if (previous?.storedName) {
    const previousPath = path.join(uploadsDir, previous.storedName);
    await unlink(previousPath).catch(() => undefined);
  }

  const updated = await updateInterview(id, {
    [kind]: {
      originalName: file.name || safeOriginal,
      storedName,
      contentType: file.type || 'application/octet-stream',
      size: buffer.length,
    } satisfies InterviewAssetMeta,
  } as unknown as InterviewUpdateInput);
  return updated;
}

export async function resolveInterviewAsset(
  id: string,
  kind: 'cv' | 'jd',
): Promise<{ filePath: string; meta: InterviewAssetMeta }> {
  const interview = await getInterview(id);
  if (!interview) {
    throw new Error('Interview not found');
  }
  const meta = interview[kind];
  if (!meta) {
    throw new Error(`${kind.toUpperCase()} asset not found`);
  }
  const filePath = path.join(uploadsDir, meta.storedName);
  await stat(filePath);
  return { filePath, meta };
}

export async function deleteInterview(id: string): Promise<boolean> {
  const current = await getInterview(id);
  if (!current) return false;

  for (const kind of ['cv', 'jd'] as const) {
    const meta = current[kind];
    if (!meta?.storedName) continue;
    const filePath = path.join(uploadsDir, meta.storedName);
    await unlink(filePath).catch(() => undefined);
  }

  const prisma = getPrismaClient();
  await prisma.interview.delete({ where: { id } });
  return true;
}
