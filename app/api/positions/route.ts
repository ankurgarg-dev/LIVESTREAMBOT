import { applyDeterministicMapping, deepDiff } from '@/lib/position/logic';
import type { PositionConfigCore } from '@/lib/position/types';
import { createPosition, listPositions } from '@/lib/server/positionStore';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const positions = await listPositions();
    return NextResponse.json({ ok: true, positions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list positions';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      rawExtraction: unknown;
      normalizedPrefill: PositionConfigCore;
      finalConfig: PositionConfigCore;
      extractionConfidence: number;
      missingFields: string[];
      createdBy?: string;
    };

    const finalMapped = applyDeterministicMapping(body.finalConfig);
    const prefillMapped = applyDeterministicMapping(body.normalizedPrefill);
    const diff = deepDiff(prefillMapped, finalMapped) ?? {};

    const created = await createPosition({
      finalConfig: finalMapped,
      normalizedPrefill: prefillMapped,
      rawExtraction: body.rawExtraction,
      extractionConfidence: Number(body.extractionConfidence || 0),
      missingFields: Array.isArray(body.missingFields) ? body.missingFields : [],
      moderatorOverridesDiff: diff,
      createdBy: String(body.createdBy || 'moderator').trim() || 'moderator',
    });

    return NextResponse.json({ ok: true, position: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save position';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
