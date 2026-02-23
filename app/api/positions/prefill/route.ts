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

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

function docxXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n');
  const noTags = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeXmlEntities(noTags)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function extractDocxTextFallback(wordPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', wordPath, 'word/document.xml']);
    return docxXmlToText(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'docx unzip extraction failed';
    if (message.includes('ENOENT')) {
      throw new Error('Unable to read .docx on this runtime (missing textutil/unzip).');
    }
    throw new Error(`Failed to parse .docx content. ${message}`);
  }
}

async function extractWordText(buffer: Buffer, extension: 'doc' | 'docx'): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jd-docx-'));
  const wordPath = path.join(tempDir, `${randomUUID()}.${extension}`);
  try {
    await fs.writeFile(wordPath, buffer);
    try {
      const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', wordPath]);
      const text = stdout.trim();
      if (text) return text;
    } catch {
      // Fallbacks below.
    }

    if (extension === 'docx') {
      const fallback = await extractDocxTextFallback(wordPath);
      if (fallback) return fallback;
    }
    throw new Error(`Failed to read .${extension} file. Extracted content was empty.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Word extraction failed';
    if (message.includes('ENOENT') || message.includes('missing textutil/unzip')) {
      throw new Error('Word file extraction is not available on this runtime. Use .txt/.md/.json/.csv/.pdf or paste JD text.');
    }
    throw new Error(`Failed to read .${extension} file. ${message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const mod = await import('pdf-parse');
    const pdfParse = (mod as unknown as { default?: (input: Buffer) => Promise<{ text?: string }> }).default ?? (mod as never);
    const parsed = await pdfParse(buffer);
    const text = String(parsed?.text || '').trim();
    if (text) return text;
  } catch {
    // Fall through to CLI/Python extractors.
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jd-pdf-'));
  const filePath = path.join(tempDir, `${randomUUID()}.pdf`);
  try {
    await fs.writeFile(filePath, buffer);

    try {
      const { stdout } = await execFileAsync('pdftotext', ['-q', '-layout', filePath, '-']);
      const text = String(stdout || '').trim();
      if (text) return text;
    } catch {
      // Fall through to python fallback.
    }

    try {
      const script = `
import sys
from pathlib import Path
pdf_path = Path(sys.argv[1])
text = ""
for module_name in ("pypdf", "PyPDF2"):
    try:
        mod = __import__(module_name)
        Reader = getattr(mod, "PdfReader", None)
        if Reader is None:
            continue
        reader = Reader(str(pdf_path))
        pages = []
        for page in reader.pages:
            pages.append((page.extract_text() or "").strip())
        text = "\\n\\n".join([p for p in pages if p])
        if text.strip():
            break
    except Exception:
        continue
sys.stdout.write(text)
`;
      const { stdout } = await execFileAsync('python3', ['-c', script, filePath]);
      const text = String(stdout || '').trim();
      if (text) return text;
    } catch {
      // Ignore if python or PDF libs unavailable.
    }

    return '';
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
    const isPdf = /\.pdf$/i.test(fileValue.name) || fileValue.type === 'application/pdf';
    const textLike = fileValue.type.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(fileValue.name);
    if (!textLike && !isDocx && !isDoc && !isPdf) {
      throw new Error(
        `Unsupported JD file type: ${fileValue.name}. Upload .txt/.md/.json/.csv/.doc/.docx/.pdf or paste JD text.`,
      );
    }
    const buffer = Buffer.from(await fileValue.arrayBuffer());
    const content =
      isDocx
        ? await extractWordText(buffer, 'docx')
        : isDoc
          ? await extractWordText(buffer, 'doc')
          : isPdf
            ? await extractPdfText(buffer)
          : decodeTextBuffer(buffer);
    if (!content) {
      if (isPdf) {
        throw new Error(
          `Uploaded JD file ${fileValue.name} has no extractable text. It may be scanned/image-only. Try a text-based PDF or paste JD text.`,
        );
      }
      throw new Error(`Uploaded JD file ${fileValue.name} appears empty or unreadable.`);
    }
    return content;
  }

  if (!pasted) {
    throw new Error('Please paste JD text or upload a supported file (.txt/.md/.json/.csv/.doc/.docx/.pdf).');
  }
  return pasted;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const roleTitle = String(form.get('roleTitle') || '').trim();
    const jdText = await readJdText(form);

    const result = await extractAndPrefillPosition({ roleTitle, jdText });
    return NextResponse.json({ ok: true, jdTextUsed: jdText, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prefill from JD';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
