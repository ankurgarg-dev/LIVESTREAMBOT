import { applyDeterministicMapping, deepDiff } from '@/lib/position/logic';
import type { PositionConfigCore } from '@/lib/position/types';
import { getPosition, updatePosition } from '@/lib/server/positionStore';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const position = await getPosition(id);
    if (!position) return NextResponse.json({ ok: false, error: 'Position not found' }, { status: 404 });
    return NextResponse.json({ ok: true, position });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load position';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as {
      finalConfig: PositionConfigCore;
      updatedBy?: string;
    };

    const current = await getPosition(id);
    if (!current) return NextResponse.json({ ok: false, error: 'Position not found' }, { status: 404 });

    const finalMapped = applyDeterministicMapping(body.finalConfig);
    const prefillMapped = applyDeterministicMapping(current.normalized_prefill);
    const diff = deepDiff(prefillMapped, finalMapped) ?? {};

    const updated = await updatePosition(id, {
      finalConfig: finalMapped,
      moderatorOverridesDiff: diff,
      extractionConfidence: current.extraction_confidence,
      missingFields: current.missing_fields,
      updatedBy: String(body.updatedBy || '').trim() || current.created_by,
    });

    return NextResponse.json({ ok: true, position: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update position';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
