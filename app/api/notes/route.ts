import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAiNote, listAiNotes, type NoteSourceType } from '@/lib/aiNotes';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;

function parseTopics(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 50);
}

async function extractText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File is larger than 12 MB.');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();

  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    const module = await import('pdf-parse');
    const parsePdf = (module as any).default || module;
    const result = await parsePdf(buffer);
    return result.text || '';
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || name.endsWith('.docx')
  ) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (
    mime.startsWith('text/')
    || name.endsWith('.txt')
    || name.endsWith('.md')
    || name.endsWith('.markdown')
  ) {
    return buffer.toString('utf8');
  }

  throw new Error('Unsupported file type. Upload PDF, DOCX, TXT, or Markdown.');
}

export async function GET(req: NextRequest) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const params = req.nextUrl.searchParams;
    const notes = await listAiNotes({
      course: params.get('course'),
      semester: params.get('semester'),
      from: params.get('from'),
      to: params.get('to'),
      limit: Number(params.get('limit') || 100),
    });
    return noStoreJson({ notes });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load notes.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const form = await req.formData();
    const fileEntry = form.get('file');
    const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
    const contentEntry = form.get('content');
    const pastedText = typeof contentEntry === 'string' ? contentEntry : '';
    const extracted = file ? await extractText(file) : pastedText;
    const content = extracted.replace(/\u0000/g, '').trim();

    if (!content) {
      return noStoreJson({ error: 'The uploaded file did not contain readable text.' }, { status: 400 });
    }
    if (content.length > MAX_TEXT_CHARS) {
      return noStoreJson(
        { error: 'The extracted note is too large. Split it into smaller files.' },
        { status: 413 },
      );
    }

    const schema = z.object({
      title: z.string().trim().min(1).max(250),
      course: z.string().trim().max(200).nullable().optional(),
      semester: z.string().trim().max(100).nullable().optional(),
      classDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      sourceType: z.enum([
        'class-notes',
        'reading-notes',
        'case-brief',
        'outline',
        'professor-material',
        'other',
      ]).optional(),
    });

    const parsed = schema.safeParse({
      title: form.get('title'),
      course: form.get('course') || null,
      semester: form.get('semester') || null,
      classDate: form.get('classDate') || null,
      sourceType: form.get('sourceType') || 'class-notes',
    });
    if (!parsed.success) {
      return noStoreJson({ error: 'Invalid note details.', issues: parsed.error.issues }, { status: 400 });
    }

    const note = await createAiNote({
      ...parsed.data,
      sourceType: parsed.data.sourceType as NoteSourceType,
      topics: parseTopics(form.get('topics')),
      originalFilename: file?.name || null,
      mimeType: file?.type || (file ? 'application/octet-stream' : 'text/plain'),
      content,
    });

    return noStoreJson({ note }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save note.';
    const status = message.startsWith('Unsupported') ? 415 : message.includes('12 MB') ? 413 : 500;
    return noStoreJson({ error: message }, { status });
  }
}
