import commonSkillTags from '@/master_data/common_skill_tags.json';
import type { InterviewPositionSnapshot } from '@/lib/server/interviewStore';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
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

async function extractDocxTextFallback(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync('unzip', ['-p', filePath, 'word/document.xml']);
  return docxXmlToText(stdout);
}

async function extractWordText(buffer: Buffer, extension: 'doc' | 'docx'): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-docx-'));
  const filePath = path.join(tempDir, `${randomUUID()}.${extension}`);
  try {
    await fs.writeFile(filePath, buffer);
    try {
      const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath]);
      const text = stdout.trim();
      if (text) return text;
    } catch {
      // Fallback below.
    }
    if (extension === 'docx') {
      return (await extractDocxTextFallback(filePath)).trim();
    }
    return '';
  } catch {
    return '';
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-pdf-'));
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
      // Ignore if python or PDF libs are unavailable.
    }

    return '';
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function compactText(input: string, max = 4000): string {
  return String(input || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function detectYearsExperience(text: string): string {
  const t = text.toLowerCase();
  const hit = t.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/);
  if (!hit) return '';
  return `${hit[1]}+ years`;
}

function detectSkills(text: string): string[] {
  const t = text.toLowerCase();
  const tags = (commonSkillTags as Array<{ canonical: string; aliases: string[] }>).filter((entry) => {
    const names = [entry.canonical, ...(entry.aliases || [])].map((x) => x.toLowerCase());
    return names.some((name) => t.includes(name));
  });
  return Array.from(new Set(tags.map((x) => x.canonical))).slice(0, 12);
}

function extractHighlights(text: string): string[] {
  const lines = text
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length >= 35 && x.length <= 220);
  const scored = lines
    .map((line) => {
      let score = 0;
      const l = line.toLowerCase();
      if (/(project|built|implemented|designed|led|delivered|deployed|optimized|migrated)/.test(l)) score += 2;
      if (/(%|ms|latency|throughput|users|cost|revenue|kpi|improv)/.test(l)) score += 2;
      if (/(powerapps|automation|sql|aws|azure|api|ml|llm|kubernetes)/.test(l)) score += 1;
      return { line, score };
    })
    .sort((a, b) => b.score - a.score);
  return Array.from(new Set(scored.map((x) => x.line))).slice(0, 4);
}

function buildCandidateContext(rawText: string): string {
  const text = compactText(rawText, 9000);
  if (!text) return '';
  const years = detectYearsExperience(text);
  const skills = detectSkills(text);
  const highlights = extractHighlights(text);
  const overview = compactText(text.split('\n').slice(0, 6).join(' '), 600);

  const parts = [
    years ? `Experience: ${years}` : '',
    skills.length ? `Key skills: ${skills.join(', ')}` : '',
    overview ? `Profile summary: ${overview}` : '',
    highlights.length ? `Project highlights: ${highlights.join(' | ')}` : '',
  ].filter(Boolean);

  return compactText(parts.join('\n'), 3800);
}

export function buildRoleContextFromPosition(
  positionSnapshot: InterviewPositionSnapshot | undefined,
  fallbackJobTitle = '',
  fallbackDepartment = '',
): string {
  if (!positionSnapshot) {
    return compactText(
      [fallbackJobTitle ? `Role: ${fallbackJobTitle}` : '', fallbackDepartment ? `Department: ${fallbackDepartment}` : '']
        .filter(Boolean)
        .join('\n'),
      2000,
    );
  }
  const role = [
    `Role: ${positionSnapshot.role_title} (${positionSnapshot.role_family}/${positionSnapshot.level})`,
    `Interview type: ${positionSnapshot.interview_round_type}; Duration: ${positionSnapshot.duration_minutes}m; Strictness: ${positionSnapshot.strictness}`,
    positionSnapshot.must_haves?.length ? `Must-haves: ${positionSnapshot.must_haves.join(', ')}` : '',
    positionSnapshot.tech_stack?.length ? `Tech stack: ${positionSnapshot.tech_stack.join(', ')}` : '',
    positionSnapshot.focus_areas?.length ? `Focus areas: ${positionSnapshot.focus_areas.join(', ')}` : '',
    positionSnapshot.notes_for_interviewer ? `Interviewer notes: ${positionSnapshot.notes_for_interviewer}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return compactText(role, 2400);
}

export async function extractCandidateContextFromUpload(file: UploadedFile | null | undefined): Promise<string> {
  if (!file || file.size <= 0) return '';
  const name = String(file.name || '').toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = '';
  if (/\.docx$/.test(name)) {
    text = await extractWordText(buffer, 'docx');
  } else if (/\.doc$/.test(name)) {
    text = await extractWordText(buffer, 'doc');
  } else if (/\.txt$/.test(name) || file.type.startsWith('text/')) {
    text = decodeTextBuffer(buffer);
  } else if (/\.pdf$/.test(name) || file.type === 'application/pdf') {
    text = await extractPdfText(buffer);
  } else {
    // Other binaries are currently not parsed in this lightweight path.
    text = '';
  }
  return buildCandidateContext(text);
}
