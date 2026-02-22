import { randomUUID } from 'crypto';
import type { PositionConfigCore, PositionConfigRecord } from '@/lib/position/types';
import { getPrismaClient } from '@/lib/server/prismaClient';

function clonePosition(value: unknown): PositionConfigRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as PositionConfigRecord;
}

export async function listPositions(): Promise<PositionConfigRecord[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.position.findMany({ orderBy: { createdAt: 'desc' } });
  return rows
    .map((row: { payload: unknown }) => clonePosition(row.payload))
    .filter((item: PositionConfigRecord | null): item is PositionConfigRecord => Boolean(item));
}

export async function getPosition(id: string): Promise<PositionConfigRecord | undefined> {
  const prisma = getPrismaClient();
  const row = await prisma.position.findUnique({ where: { id } });
  const parsed = clonePosition(row?.payload);
  return parsed ?? undefined;
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
  const prisma = getPrismaClient();
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
  const prisma = getPrismaClient();
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
}

export async function deletePosition(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  await prisma.position.delete({ where: { id } });
  return true;
}
