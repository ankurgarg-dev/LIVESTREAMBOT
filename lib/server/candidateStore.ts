import { randomUUID } from 'crypto';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { CanonicalSkillRef } from '@/lib/position/types';
import { getPrismaClient } from '@/lib/server/prismaClient';
import type { CvJdDetailedScorecard, CvJdScorecard } from '@/lib/server/cvJdScoring';
import type { AiScreeningResult } from '@/lib/server/aiScreening';

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type CandidateAssetMeta = {
  originalName: string;
  storedName: string;
  contentType: string;
  size: number;
};

export type CandidateMasterRecord = {
  id: string;
  fullName: string;
  email: string;
  currentTitle?: string;
  yearsExperience?: string;
  keySkills?: string[];
  candidateContext?: string;
  screeningCache?: Record<string, StoredCandidateScreening>;
  cv?: CandidateAssetMeta;
  createdAt: string;
  updatedAt: string;
};

export type StoredCandidateScreening = {
  candidateId: string;
  positionId: string;
  deterministicRecommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  cvJdScorecard?: CvJdScorecard;
  detailedScorecard?: CvJdDetailedScorecard;
  aiScreening?: AiScreeningResult;
  blendedScore: number;
  blendedRecommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  updatedAt: string;
};

export type CandidateApplicationRecord = {
  id: string;
  positionId: string;
  candidateId?: string;
  candidateName: string;
  candidateEmail: string;
  candidateContext: string;
  roleContext: string;
  cv?: CandidateAssetMeta;
  cvJdScorecard?: CvJdScorecard;
  detailedScorecard?: CvJdDetailedScorecard;
  canonical_skills?: {
    must_haves: CanonicalSkillRef[];
    nice_to_haves: CanonicalSkillRef[];
    tech_stack: CanonicalSkillRef[];
  };
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  aiScreening?: AiScreeningResult;
  blendedScore?: number;
  blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  roomName?: string;
  interviewAgentType?: 'classic' | 'realtime_screening';
  createdAt: string;
  updatedAt: string;
};

const baseDir =
  process.env.INTERVIEW_DATA_DIR ?? path.join(os.homedir(), '.bristlecone-data', 'interviews');
const uploadsDir = path.join(baseDir, 'candidate-uploads');

async function ensureStoreDirs() {
  await mkdir(uploadsDir, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function asCandidateMasterRecord(value: unknown): CandidateMasterRecord | null {
  if (!value || typeof value !== 'object') return null;
  const typed = value as CandidateMasterRecord;
  return {
    id: String(typed.id || '').trim(),
    fullName: String(typed.fullName || '').trim(),
    email: String(typed.email || '').trim(),
    currentTitle: String(typed.currentTitle || '').trim() || undefined,
    yearsExperience: String(typed.yearsExperience || '').trim() || undefined,
    keySkills: Array.isArray(typed.keySkills) ? typed.keySkills.map(String).filter(Boolean) : undefined,
    candidateContext: String(typed.candidateContext || '').trim() || undefined,
    screeningCache:
      typed.screeningCache && typeof typed.screeningCache === 'object'
        ? (typed.screeningCache as Record<string, StoredCandidateScreening>)
        : undefined,
    cv:
      typed.cv && typeof typed.cv === 'object'
        ? {
            originalName: String(typed.cv.originalName || ''),
            storedName: String(typed.cv.storedName || ''),
            contentType: String(typed.cv.contentType || 'application/octet-stream'),
            size: Number(typed.cv.size || 0),
          }
        : undefined,
    createdAt: String(typed.createdAt || ''),
    updatedAt: String(typed.updatedAt || ''),
  };
}

function asCandidateRecord(value: unknown): CandidateApplicationRecord | null {
  if (!value || typeof value !== 'object') return null;
  const typed = value as CandidateApplicationRecord;
  const id = String(typed.id || '').trim();
  const roleSlug = String(typed.positionId || 'position').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 18) || 'position';
  const fallbackRoom = `app-${roleSlug}-${id.slice(0, 8)}`;
  const aiScore = Number((typed.aiScreening as AiScreeningResult | undefined)?.score || 0);
  const deterministicScore = Number(typed.cvJdScorecard?.overallScore || 0);
  const inferredBlendedScore = Math.round(
    aiScore > 0 ? deterministicScore * 0.5 + aiScore * 0.5 : deterministicScore,
  );
  const blendedRecommendation =
    typed.blendedRecommendation === 'strong_fit' ||
    typed.blendedRecommendation === 'fit' ||
    typed.blendedRecommendation === 'borderline'
      ? typed.blendedRecommendation
      : typed.recommendation === 'strong_fit' || typed.recommendation === 'fit' || typed.recommendation === 'borderline'
        ? typed.recommendation
        : 'reject';
  return {
    id,
    positionId: String(typed.positionId || '').trim(),
    candidateId: String(typed.candidateId || '').trim() || undefined,
    candidateName: String(typed.candidateName || '').trim(),
    candidateEmail: String(typed.candidateEmail || '').trim(),
    candidateContext: String(typed.candidateContext || ''),
    roleContext: String(typed.roleContext || ''),
    cv: typed.cv && typeof typed.cv === 'object'
      ? {
          originalName: String(typed.cv.originalName || ''),
          storedName: String(typed.cv.storedName || ''),
          contentType: String(typed.cv.contentType || 'application/octet-stream'),
          size: Number(typed.cv.size || 0),
        }
      : undefined,
    cvJdScorecard: typed.cvJdScorecard,
    detailedScorecard: typed.detailedScorecard,
    canonical_skills:
      typed.canonical_skills && typeof typed.canonical_skills === 'object'
        ? {
            must_haves: Array.isArray(typed.canonical_skills.must_haves) ? typed.canonical_skills.must_haves : [],
            nice_to_haves: Array.isArray(typed.canonical_skills.nice_to_haves) ? typed.canonical_skills.nice_to_haves : [],
            tech_stack: Array.isArray(typed.canonical_skills.tech_stack) ? typed.canonical_skills.tech_stack : [],
          }
        : undefined,
    recommendation: typed.recommendation === 'strong_fit' || typed.recommendation === 'fit' || typed.recommendation === 'borderline'
      ? typed.recommendation
      : 'reject',
    conclusion: String(typed.conclusion || '').trim(),
    aiScreening: typed.aiScreening as AiScreeningResult | undefined,
    blendedScore: Number.isFinite(Number(typed.blendedScore)) ? Number(typed.blendedScore) : inferredBlendedScore,
    blendedRecommendation,
    roomName: String(typed.roomName || fallbackRoom).trim(),
    interviewAgentType: typed.interviewAgentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
    createdAt: String(typed.createdAt || ''),
    updatedAt: String(typed.updatedAt || ''),
  };
}

export async function listCandidates(): Promise<CandidateMasterRecord[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.candidate.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows
    .map((row: { payload: unknown }) => asCandidateMasterRecord(row.payload))
    .filter((item: CandidateMasterRecord | null): item is CandidateMasterRecord => Boolean(item));
}

export async function getCandidate(id: string): Promise<CandidateMasterRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.candidate.findUnique({ where: { id } });
  const parsed = asCandidateMasterRecord(row?.payload);
  return parsed ?? undefined;
}

export async function getStoredCandidateScreening(
  candidateId: string,
  positionId: string,
): Promise<StoredCandidateScreening | undefined> {
  const candidate = await getCandidate(candidateId);
  if (!candidate?.screeningCache) return undefined;
  const row = candidate.screeningCache[positionId];
  if (!row) return undefined;
  return row;
}

export async function setStoredCandidateScreening(
  candidateId: string,
  positionId: string,
  screening: Omit<StoredCandidateScreening, 'candidateId' | 'positionId' | 'updatedAt'>,
): Promise<StoredCandidateScreening> {
  const prisma = getPrismaClient();
  const row = await prisma.candidate.findUnique({ where: { id: candidateId } });
  const current = asCandidateMasterRecord(row?.payload);
  if (!current) throw new Error('Candidate not found');

  const nextScreening: StoredCandidateScreening = {
    candidateId,
    positionId,
    ...screening,
    updatedAt: new Date().toISOString(),
  };
  const next: CandidateMasterRecord = {
    ...current,
    screeningCache: {
      ...(current.screeningCache || {}),
      [positionId]: nextScreening,
    },
    updatedAt: new Date().toISOString(),
  };
  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      fullName: next.fullName,
      email: next.email,
      updatedAt: new Date(next.updatedAt),
      payload: next,
    },
  });
  return nextScreening;
}

export async function upsertCandidate(input: {
  candidateName: string;
  candidateEmail: string;
  currentTitle?: string;
  yearsExperience?: string;
  keySkills?: string[];
  candidateContext?: string;
}): Promise<CandidateMasterRecord> {
  const prisma = getPrismaClient();
  const email = String(input.candidateEmail || '').trim().toLowerCase();
  const fullName = String(input.candidateName || '').trim() || 'Unknown Candidate';

  const existing = email
    ? await prisma.candidate.findFirst({
        where: { email },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  if (existing) {
    const current: CandidateMasterRecord =
      asCandidateMasterRecord(existing.payload) || {
        id: existing.id,
        fullName,
        email,
        currentTitle: undefined,
        yearsExperience: undefined,
        keySkills: undefined,
        candidateContext: undefined,
        cv: undefined,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: existing.updatedAt.toISOString(),
      };
    const updated: CandidateMasterRecord = {
      ...current,
      fullName: fullName || current.fullName,
      email: email || current.email,
      currentTitle: input.currentTitle || current.currentTitle,
      yearsExperience: input.yearsExperience || current.yearsExperience,
      keySkills: input.keySkills && input.keySkills.length > 0 ? input.keySkills : current.keySkills,
      candidateContext: input.candidateContext || current.candidateContext,
      updatedAt: new Date().toISOString(),
    };
    await prisma.candidate.update({
      where: { id: existing.id },
      data: {
        fullName: updated.fullName,
        email: updated.email,
        updatedAt: new Date(updated.updatedAt),
        payload: updated,
      },
    });
    return updated;
  }

  const now = new Date().toISOString();
  const created: CandidateMasterRecord = {
    id: randomUUID(),
    fullName,
    email,
    currentTitle: String(input.currentTitle || '').trim() || undefined,
    yearsExperience: String(input.yearsExperience || '').trim() || undefined,
    keySkills: Array.isArray(input.keySkills) ? input.keySkills.map(String).filter(Boolean) : undefined,
    candidateContext: String(input.candidateContext || '').trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await prisma.candidate.create({
    data: {
      id: created.id,
      fullName: created.fullName,
      email: created.email,
      createdAt: new Date(created.createdAt),
      updatedAt: new Date(created.updatedAt),
      payload: created,
    },
  });
  return created;
}

export async function listCandidateApplications(positionId?: string): Promise<CandidateApplicationRecord[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.candidateApplication.findMany({
    where: positionId ? { positionId } : undefined,
    orderBy: { updatedAt: 'desc' },
  });
  return rows
    .map((row: { payload: unknown }) => asCandidateRecord(row.payload))
    .filter((item: CandidateApplicationRecord | null): item is CandidateApplicationRecord => Boolean(item));
}

export async function getLatestCandidateApplicationByRoom(
  roomName: string,
): Promise<CandidateApplicationRecord | undefined> {
  const target = String(roomName || '').trim();
  if (!target) return undefined;
  const all = await listCandidateApplications();
  return all
    .filter((item) => String(item.roomName || '').trim() === target)
    .sort((a, b) => Date.parse(String(b.updatedAt || '')) - Date.parse(String(a.updatedAt || '')))[0];
}

export async function getCandidateApplication(id: string): Promise<CandidateApplicationRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.candidateApplication.findUnique({ where: { id } });
  const parsed = asCandidateRecord(row?.payload);
  return parsed ?? undefined;
}

export async function createCandidateApplication(input: {
  positionId: string;
  candidateId?: string;
  candidateName: string;
  candidateEmail: string;
  candidateContext: string;
  roleContext: string;
  cvJdScorecard?: CvJdScorecard;
  detailedScorecard?: CvJdDetailedScorecard;
  canonicalSkills?: {
    must_haves: CanonicalSkillRef[];
    nice_to_haves: CanonicalSkillRef[];
    tech_stack: CanonicalSkillRef[];
  };
  recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  conclusion: string;
  aiScreening?: AiScreeningResult;
  blendedScore?: number;
  blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
  roomName?: string;
  interviewAgentType?: 'classic' | 'realtime_screening';
}): Promise<CandidateApplicationRecord> {
  const prisma = getPrismaClient();
  if (input.candidateId) {
    const existing = await prisma.candidateApplication.findFirst({
      where: {
        candidateId: input.candidateId,
        positionId: input.positionId,
      },
      select: { id: true },
    });
    if (existing) {
      throw new Error('Candidate is already applied to this position.');
    }
  }
  const now = new Date().toISOString();
  const roleSlug = String(input.positionId || 'position').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 18) || 'position';
  const roomName = String(input.roomName || '').trim() || `app-${roleSlug}-${randomUUID().slice(0, 8)}`;
  const record: CandidateApplicationRecord = {
    id: randomUUID(),
    positionId: input.positionId,
    candidateId: String(input.candidateId || '').trim() || undefined,
    candidateName: input.candidateName,
    candidateEmail: input.candidateEmail,
    candidateContext: input.candidateContext,
    roleContext: input.roleContext,
    cvJdScorecard: input.cvJdScorecard,
    detailedScorecard: input.detailedScorecard,
    canonical_skills: input.canonicalSkills,
    recommendation: input.recommendation,
    conclusion: input.conclusion,
    aiScreening: input.aiScreening,
    blendedScore: Number.isFinite(Number(input.blendedScore)) ? Number(input.blendedScore) : undefined,
    blendedRecommendation:
      input.blendedRecommendation === 'strong_fit' ||
      input.blendedRecommendation === 'fit' ||
      input.blendedRecommendation === 'borderline'
        ? input.blendedRecommendation
        : undefined,
    roomName,
    interviewAgentType: input.interviewAgentType === 'realtime_screening' ? 'realtime_screening' : 'classic',
    createdAt: now,
    updatedAt: now,
  };
  await prisma.candidateApplication.create({
    data: {
      id: record.id,
      positionId: record.positionId,
      candidateId: record.candidateId,
      candidateName: record.candidateName,
      candidateEmail: record.candidateEmail,
      overallScore: Number(record.cvJdScorecard?.overallScore || 0),
      recommendation: record.recommendation,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      payload: record,
    },
  });
  return record;
}

export async function deleteCandidateApplication(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  await prisma.candidateApplication.delete({ where: { id } });
  return true;
}

export async function updateCandidateApplicationInterviewSettings(
  id: string,
  input: {
    interviewAgentType?: 'classic' | 'realtime_screening';
    roomName?: string;
  },
): Promise<CandidateApplicationRecord> {
  const prisma = getPrismaClient();
  const row = await prisma.candidateApplication.findUnique({ where: { id } });
  const current = asCandidateRecord(row?.payload);
  if (!current) throw new Error('Candidate application not found');

  const next: CandidateApplicationRecord = {
    ...current,
    interviewAgentType:
      input.interviewAgentType === 'realtime_screening' ? 'realtime_screening' : current.interviewAgentType || 'classic',
    roomName: String(input.roomName || '').trim() || current.roomName,
    updatedAt: new Date().toISOString(),
  };

  await prisma.candidateApplication.update({
    where: { id },
    data: {
      updatedAt: new Date(next.updatedAt),
      payload: next,
      recommendation: next.recommendation,
      overallScore: Number(next.cvJdScorecard?.overallScore || 0),
    },
  });
  return next;
}

export async function attachCandidateCv(
  id: string,
  file: UploadedFile,
): Promise<CandidateApplicationRecord> {
  const current = await getCandidateApplication(id);
  if (!current) throw new Error('Candidate application not found');
  if (!(file && typeof file.arrayBuffer === 'function' && file.size > 0)) {
    throw new Error('Missing CV file');
  }
  await ensureStoreDirs();
  const safeOriginal = sanitizeFilename(file.name || 'cv.bin');
  const storedName = `${id}_cv_${Date.now()}_${safeOriginal}`;
  const filePath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  if (current.cv?.storedName) {
    const prevPath = path.join(uploadsDir, current.cv.storedName);
    await unlink(prevPath).catch(() => undefined);
  }

  const updated: CandidateApplicationRecord = {
    ...current,
    cv: {
      originalName: file.name || safeOriginal,
      storedName,
      contentType: file.type || 'application/octet-stream',
      size: buffer.length,
    },
    updatedAt: new Date().toISOString(),
  };

  const prisma = getPrismaClient();
  await prisma.candidateApplication.update({
    where: { id },
    data: {
      updatedAt: new Date(updated.updatedAt),
      payload: updated,
      overallScore: Number(updated.cvJdScorecard?.overallScore || 0),
      recommendation: updated.recommendation,
    },
  });

  if (updated.candidateId) {
    const candidate = await getCandidate(updated.candidateId);
    if (candidate) {
      const candidateUpdated: CandidateMasterRecord = {
        ...candidate,
        cv: updated.cv,
        updatedAt: new Date().toISOString(),
      };
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          fullName: candidateUpdated.fullName,
          email: candidateUpdated.email,
          updatedAt: new Date(candidateUpdated.updatedAt),
          payload: candidateUpdated,
        },
      });
    }
  }

  return updated;
}

export async function resolveCandidateCvAsset(
  id: string,
): Promise<{ filePath: string; meta: CandidateAssetMeta }> {
  const candidate = await getCandidateApplication(id);
  if (!candidate || !candidate.cv?.storedName) {
    throw new Error('CV not found for candidate application');
  }
  const filePath = path.join(uploadsDir, candidate.cv.storedName);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error('Stored CV file missing');
  }
  return { filePath, meta: candidate.cv };
}
