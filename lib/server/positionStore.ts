import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { PositionConfigCore, PositionConfigRecord } from '@/lib/position/types';
import { getPrismaClient } from '@/lib/server/prismaClient';

type PositionPayload = { positions: PositionConfigRecord[] };

const baseDir =
  process.env.POSITION_DATA_DIR ?? path.join(os.homedir(), '.bristlecone-data', 'positions');
const dbPath = path.join(baseDir, 'positions.json');

let bootstrapped = false;

async function ensureDir() {
  await mkdir(baseDir, { recursive: true });
}

async function readPayload(): Promise<PositionPayload> {
  await ensureDir();
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw) as PositionPayload;
    if (!Array.isArray(parsed.positions)) return { positions: [] };
    return parsed;
  } catch {
    return { positions: [] };
  }
}

async function writePayload(payload: PositionPayload): Promise<void> {
  await ensureDir();
  await writeFile(dbPath, JSON.stringify(payload, null, 2), 'utf8');
}

function clonePosition(value: unknown): PositionConfigRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as PositionConfigRecord;
}

async function bootstrapFromFileIfNeeded() {
  if (bootstrapped) return;
  bootstrapped = true;
  const prisma = getPrismaClient();
  if (!prisma) return;
  try {
    const count = await prisma.position.count();
    if (count > 0) return;
    const filePayload = await readPayload();
    if (filePayload.positions.length === 0) return;
    for (const p of filePayload.positions) {
      await prisma.position.create({
        data: {
          id: p.position_id,
          roleTitle: p.role_title,
          createdAt: new Date(p.created_at),
          updatedAt: new Date(p.updated_at),
          payload: p,
        },
      });
    }
  } catch (error) {
    console.warn('[storage] position bootstrap fallback to file store:', error);
  }
}

async function listPositionsFile(): Promise<PositionConfigRecord[]> {
  const payload = await readPayload();
  return payload.positions.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

async function getPositionFile(id: string): Promise<PositionConfigRecord | undefined> {
  const payload = await readPayload();
  return payload.positions.find((p) => p.position_id === id);
}

async function createPositionFile(input: {
  finalConfig: PositionConfigCore;
  normalizedPrefill: PositionConfigCore;
  rawExtraction: unknown;
  extractionConfidence: number;
  missingFields: string[];
  moderatorOverridesDiff: unknown;
  createdBy: string;
}): Promise<PositionConfigRecord> {
  const payload = await readPayload();
  const now = new Date().toISOString();
  const record: PositionConfigRecord = {
    position_id: randomUUID(),
    ...input.finalConfig,
    extracted_from_jd_raw: input.rawExtraction,
    normalized_prefill: input.normalizedPrefill,
    extraction_confidence: input.extractionConfidence,
    missing_fields: input.missingFields,
    moderator_overrides_diff: input.moderatorOverridesDiff,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    version: 1,
  };

  payload.positions.push(record);
  await writePayload(payload);
  return record;
}

async function updatePositionFile(
  id: string,
  input: {
    finalConfig: PositionConfigCore;
    moderatorOverridesDiff: unknown;
    extractionConfidence?: number;
    missingFields?: string[];
    updatedBy?: string;
  },
): Promise<PositionConfigRecord> {
  const payload = await readPayload();
  const index = payload.positions.findIndex((entry) => entry.position_id === id);
  if (index < 0) throw new Error('Position not found');
  const current = payload.positions[index];

  const next: PositionConfigRecord = {
    ...current,
    ...input.finalConfig,
    moderator_overrides_diff: input.moderatorOverridesDiff,
    extraction_confidence:
      typeof input.extractionConfidence === 'number' ? input.extractionConfidence : current.extraction_confidence,
    missing_fields: input.missingFields ?? current.missing_fields,
    created_by: input.updatedBy || current.created_by,
    updated_at: new Date().toISOString(),
    version: current.version + 1,
  };

  payload.positions[index] = next;
  await writePayload(payload);
  return next;
}

async function deletePositionFile(id: string): Promise<boolean> {
  const payload = await readPayload();
  const before = payload.positions.length;
  payload.positions = payload.positions.filter((entry) => entry.position_id !== id);
  if (payload.positions.length === before) return false;
  await writePayload(payload);
  return true;
}

export async function listPositions(): Promise<PositionConfigRecord[]> {
  await bootstrapFromFileIfNeeded();
  const prisma = getPrismaClient();
  if (!prisma) return listPositionsFile();
  try {
    const rows = await prisma.position.findMany({ orderBy: { createdAt: 'desc' } });
    return rows
      .map((row: { payload: unknown }) => clonePosition(row.payload))
      .filter((item: PositionConfigRecord | null): item is PositionConfigRecord => Boolean(item));
  } catch {
    return listPositionsFile();
  }
}

export async function getPosition(id: string): Promise<PositionConfigRecord | undefined> {
  await bootstrapFromFileIfNeeded();
  const prisma = getPrismaClient();
  if (!prisma) return getPositionFile(id);
  try {
    const row = await prisma.position.findUnique({ where: { id } });
    const parsed = clonePosition(row?.payload);
    return parsed ?? undefined;
  } catch {
    return getPositionFile(id);
  }
}

export async function createPosition(input: {
  finalConfig: PositionConfigCore;
  normalizedPrefill: PositionConfigCore;
  rawExtraction: unknown;
  extractionConfidence: number;
  missingFields: string[];
  moderatorOverridesDiff: unknown;
  createdBy: string;
}): Promise<PositionConfigRecord> {
  await bootstrapFromFileIfNeeded();
  const prisma = getPrismaClient();
  if (!prisma) return createPositionFile(input);
  try {
    const now = new Date().toISOString();
    const record: PositionConfigRecord = {
      position_id: randomUUID(),
      ...input.finalConfig,
      extracted_from_jd_raw: input.rawExtraction,
      normalized_prefill: input.normalizedPrefill,
      extraction_confidence: input.extractionConfidence,
      missing_fields: input.missingFields,
      moderator_overrides_diff: input.moderatorOverridesDiff,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    await prisma.position.create({
      data: {
        id: record.position_id,
        roleTitle: record.role_title,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at),
        payload: record,
      },
    });
    return record;
  } catch {
    return createPositionFile(input);
  }
}

export async function updatePosition(
  id: string,
  input: {
    finalConfig: PositionConfigCore;
    moderatorOverridesDiff: unknown;
    extractionConfidence?: number;
    missingFields?: string[];
    updatedBy?: string;
  },
): Promise<PositionConfigRecord> {
  await bootstrapFromFileIfNeeded();
  const prisma = getPrismaClient();
  if (!prisma) return updatePositionFile(id, input);
  try {
    const row = await prisma.position.findUnique({ where: { id } });
    const current = clonePosition(row?.payload);
    if (!current) throw new Error('Position not found');
    const next: PositionConfigRecord = {
      ...current,
      ...input.finalConfig,
      moderator_overrides_diff: input.moderatorOverridesDiff,
      extraction_confidence:
        typeof input.extractionConfidence === 'number' ? input.extractionConfidence : current.extraction_confidence,
      missing_fields: input.missingFields ?? current.missing_fields,
      created_by: input.updatedBy || current.created_by,
      updated_at: new Date().toISOString(),
      version: current.version + 1,
    };
    await prisma.position.update({
      where: { id },
      data: {
        roleTitle: next.role_title,
        updatedAt: new Date(next.updated_at),
        payload: next,
      },
    });
    return next;
  } catch {
    return updatePositionFile(id, input);
  }
}

export async function deletePosition(id: string): Promise<boolean> {
  await bootstrapFromFileIfNeeded();
  const prisma = getPrismaClient();
  if (!prisma) return deletePositionFile(id);
  try {
    await prisma.position.delete({ where: { id } });
    return true;
  } catch {
    return deletePositionFile(id);
  }
}
