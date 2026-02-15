import { resolveInterviewAsset } from '@/lib/server/interviewStore';
import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const kindRaw = req.nextUrl.searchParams.get('kind');
    if (kindRaw !== 'cv' && kindRaw !== 'jd') {
      return NextResponse.json({ error: 'kind must be cv or jd' }, { status: 400 });
    }

    const { filePath, meta } = await resolveInterviewAsset(id, kindRaw);
    const fileBuffer = await readFile(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': meta.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${meta.originalName.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch asset';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
