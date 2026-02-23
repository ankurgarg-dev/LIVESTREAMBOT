import { resolveCandidateCvAsset } from '@/lib/server/candidateStore';
import { createReadStream } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';

function toWebStream(nodeStream: ReturnType<typeof createReadStream>): ReadableStream<Uint8Array> {
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

function buildDisposition(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { filePath, meta } = await resolveCandidateCvAsset(id);
    const stream = createReadStream(filePath);
    return new NextResponse(toWebStream(stream), {
      headers: {
        'content-type': meta.contentType || 'application/octet-stream',
        'content-length': String(meta.size || 0),
        'content-disposition': buildDisposition(meta.originalName || 'cv.bin'),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve candidate asset';
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}
