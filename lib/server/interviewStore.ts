import { randomUUID } from 'crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';

export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled';
export type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | '';
export type InterviewAgentType = 'classic' | 'realtime_screening';

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
  >
>;

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type InterviewStorePayload = {
  interviews: InterviewRecord[];
};

const baseDir = process.env.INTERVIEW_DATA_DIR ?? path.join('/tmp', 'bristlecone-interviews');
const uploadsDir = path.join(baseDir, 'uploads');
const dbPath = path.join(baseDir, 'interviews.json');

async function ensureStoreDirs() {
  await mkdir(uploadsDir, { recursive: true });
}

async function readPayload(): Promise<InterviewStorePayload> {
  await ensureStoreDirs();
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw) as InterviewStorePayload;
    if (!Array.isArray(parsed.interviews)) {
      return { interviews: [] };
    }
    return {
      interviews: parsed.interviews.map((entry) => ({
        ...entry,
        agentType: entry.agentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
      })),
    };
  } catch {
    return { interviews: [] };
  }
}

async function writePayload(payload: InterviewStorePayload): Promise<void> {
  await ensureStoreDirs();
  await writeFile(dbPath, JSON.stringify(payload, null, 2), 'utf8');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function listInterviews(): Promise<InterviewRecord[]> {
  const payload = await readPayload();
  return payload.interviews.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getInterview(id: string): Promise<InterviewRecord | undefined> {
  const payload = await readPayload();
  return payload.interviews.find((entry) => entry.id === id);
}

export async function getLatestInterviewByRoom(roomName: string): Promise<InterviewRecord | undefined> {
  const target = String(roomName || '').trim().toLowerCase();
  if (!target) return undefined;
  const payload = await readPayload();
  return payload.interviews
    .filter((entry) => String(entry.roomName || '').trim().toLowerCase() === target)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0];
}

export async function createInterview(input: InterviewCreateInput): Promise<InterviewRecord> {
  const payload = await readPayload();
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
    positionId: input.positionId,
    positionSnapshot: input.positionSnapshot,
    createdAt: now,
    updatedAt: now,
  };
  payload.interviews.push(interview);
  await writePayload(payload);
  return interview;
}

export async function updateInterview(id: string, updates: InterviewUpdateInput): Promise<InterviewRecord> {
  const payload = await readPayload();
  const index = payload.interviews.findIndex((entry) => entry.id === id);
  if (index < 0) {
    throw new Error('Interview not found');
  }
  const current = payload.interviews[index];
  const next: InterviewRecord = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  payload.interviews[index] = next;
  await writePayload(payload);
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
  const payload = await readPayload();
  const index = payload.interviews.findIndex((entry) => entry.id === id);
  if (index < 0) {
    throw new Error('Interview not found');
  }
  await ensureStoreDirs();
  const safeOriginal = sanitizeFilename(file.name || `${kind}.bin`);
  const storedName = `${id}_${kind}_${Date.now()}_${safeOriginal}`;
  const filePath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const current = payload.interviews[index];
  const previous = current[kind];
  if (previous?.storedName) {
    const previousPath = path.join(uploadsDir, previous.storedName);
    await unlink(previousPath).catch(() => undefined);
  }

  const updated: InterviewRecord = {
    ...current,
    [kind]: {
      originalName: file.name || safeOriginal,
      storedName,
      contentType: file.type || 'application/octet-stream',
      size: buffer.length,
    } satisfies InterviewAssetMeta,
    updatedAt: new Date().toISOString(),
  };

  payload.interviews[index] = updated;
  await writePayload(payload);
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
