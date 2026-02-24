import { randomUUID } from 'crypto';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { CanonicalSkillRef } from '@/lib/position/types';
import { getPrismaClient } from '@/lib/server/prismaClient';
import type { CvJdDetailedScorecard, CvJdScorecard } from '@/lib/server/cvJdScoring';

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

export type CandidateApplicationRecord = {
  id: string;
  positionId: string;
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

function asCandidateRecord(value: unknown): CandidateApplicationRecord | null {
  if (!value || typeof value !== 'object') return null;
  const typed = value as CandidateApplicationRecord;
  return {
    id: String(typed.id || '').trim(),
    positionId: String(typed.positionId || '').trim(),
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
    createdAt: String(typed.createdAt || ''),
    updatedAt: String(typed.updatedAt || ''),
  };
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

export async function getCandidateApplication(id: string): Promise<CandidateApplicationRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.candidateApplication.findUnique({ where: { id } });
  const parsed = asCandidateRecord(row?.payload);
  return parsed ?? undefined;
}

export async function createCandidateApplication(input: {
  positionId: string;
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
}): Promise<CandidateApplicationRecord> {
  const prisma = getPrismaClient();
  const now = new Date().toISOString();
  const record: CandidateApplicationRecord = {
    id: randomUUID(),
    positionId: input.positionId,
    candidateName: input.candidateName,
    candidateEmail: input.candidateEmail,
    candidateContext: input.candidateContext,
    roleContext: input.roleContext,
    cvJdScorecard: input.cvJdScorecard,
    detailedScorecard: input.detailedScorecard,
    canonical_skills: input.canonicalSkills,
    recommendation: input.recommendation,
    conclusion: input.conclusion,
    createdAt: now,
    updatedAt: now,
  };
  await prisma.candidateApplication.create({
    data: {
      id: record.id,
      positionId: record.positionId,
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
