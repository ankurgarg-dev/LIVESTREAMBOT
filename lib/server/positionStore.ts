import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { PositionConfigCore, PositionConfigRecord } from '@/lib/position/types';

type PositionPayload = { positions: PositionConfigRecord[] };

const baseDir = process.env.POSITION_DATA_DIR ?? path.join('/tmp', 'bristlecone-positions');
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
