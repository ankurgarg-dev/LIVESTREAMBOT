import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { PositionConfigCore, PositionConfigRecord } from '@/lib/position/types';

type PositionPayload = { positions: PositionConfigRecord[] };

const baseDir =
  process.env.POSITION_DATA_DIR ?? path.join(os.homedir(), '.bristlecone-data', 'positions');
const dbPath = path.join(baseDir, 'positions.json');

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

export async function listPositions(): Promise<PositionConfigRecord[]> {
  const payload = await readPayload();
  return payload.positions.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getPosition(id: string): Promise<PositionConfigRecord | undefined> {
  const payload = await readPayload();
  return payload.positions.find((p) => p.position_id === id);
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

export async function deletePosition(id: string): Promise<boolean> {
  const payload = await readPayload();
  const before = payload.positions.length;
  payload.positions = payload.positions.filter((entry) => entry.position_id !== id);
  if (payload.positions.length === before) return false;
  await writePayload(payload);
  return true;
}
