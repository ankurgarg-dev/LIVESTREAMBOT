import { extractAndPrefillPosition } from '@/lib/server/jdExtractor';
import { NextRequest, NextResponse } from 'next/server';

async function readJdText(form: FormData): Promise<string> {
  const pasted = String(form.get('jdText') || '').trim();
  const fileValue = form.get('jdFile');

  if (fileValue && typeof fileValue !== 'string' && fileValue.size > 0) {
    const textLike = fileValue.type.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(fileValue.name);
    if (textLike) {
      const content = Buffer.from(await fileValue.arrayBuffer()).toString('utf8').trim();
      if (content) return content;
    }
  }

  return pasted;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const roleTitle = String(form.get('roleTitle') || '').trim();
    const jdText = await readJdText(form);

    const result = await extractAndPrefillPosition({ roleTitle, jdText });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prefill from JD';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
