import { extractAndPrefillPosition } from '@/lib/server/jdExtractor';
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8').trim();
  if (utf8 && !utf8.includes('\u0000')) return utf8;
  const utf16 = buffer.toString('utf16le').trim();
  if (utf16) return utf16;
  return utf8;
}

async function extractWordText(buffer: Buffer, extension: 'doc' | 'docx'): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jd-docx-'));
  const wordPath = path.join(tempDir, `${randomUUID()}.${extension}`);
  try {
    await fs.writeFile(wordPath, buffer);
    const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', wordPath]);
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Word extraction failed';
    if (message.includes('ENOENT')) {
      throw new Error('Word file extraction is not available on this runtime. Use .txt/.md/.json/.csv or paste JD text.');
    }
    throw new Error(`Failed to read .${extension} file. ${message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function readJdText(form: FormData): Promise<string> {
  const pasted = String(form.get('jdText') || '').trim();
  const fileValue = form.get('jdFile');

  if (fileValue && typeof fileValue !== 'string' && fileValue.size > 0) {
    const isDocx = /\.docx$/i.test(fileValue.name);
    const isDoc = /\.doc$/i.test(fileValue.name);
    const textLike = fileValue.type.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(fileValue.name);
    if (!textLike && !isDocx && !isDoc) {
      throw new Error(
        `Unsupported JD file type: ${fileValue.name}. Upload .txt/.md/.json/.csv/.doc/.docx or paste JD text.`,
      );
    }
    const buffer = Buffer.from(await fileValue.arrayBuffer());
    const content =
      isDocx
        ? await extractWordText(buffer, 'docx')
        : isDoc
          ? await extractWordText(buffer, 'doc')
          : decodeTextBuffer(buffer);
    if (!content) {
      throw new Error(`Uploaded JD file ${fileValue.name} appears empty or unreadable.`);
    }
    return content;
  }

  if (!pasted) {
    throw new Error('Please paste JD text or upload a supported file (.txt/.md/.json/.csv/.doc/.docx).');
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
