import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createAiNote,
  listAiNotes,
  searchAiNotes,
  type NoteSourceType,
} from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;

const sourceTypes = [
  'class-notes',
  'reading-notes',
  'case-brief',
  'outline',
  'professor-material',
  'other',
] as const;

const noteSchema = z.object({
  title: z.string().trim().min(1).max(250).default('Untitled Page'),
  notebookId: z.string().trim().max(200).nullable().optional(),
  course: z.string().trim().max(200).nullable().optional(),
  semester: z.string().trim().max(100).nullable().optional(),
  section: z.string().trim().max(120).nullable().optional(),
  classDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceType: z.enum(sourceTypes).optional(),
  topics: z.array(z.string().trim().max(100)).max(50).optional(),
  pinned: z.boolean().optional(),
  content: z.string().max(MAX_TEXT_CHARS).optional(),
});

function parseTopics(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean).slice(0, 50);
  }
  if (typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 50);
}

function nullableString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
    const module = await import('mammoth');
    const mammoth = (module as any).default || module;
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
  try {
    const params = req.nextUrl.searchParams;
    const filters = {
      notebookId: params.get('notebookId'),
      course: params.get('course'),
      semester: params.get('semester'),
      section: params.get('section'),
      from: params.get('from'),
      to: params.get('to'),
      archived: params.get('archived') === 'true',
      limit: Number(params.get('limit') || 500),
    };
    const query = params.get('q')?.trim() || '';
    const notes = query
      ? await searchAiNotes(query, filters)
      : await listAiNotes(filters);
    return noStoreJson({ notes });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load notes.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      const parsed = noteSchema.safeParse({
        ...body,
        topics: parseTopics(body?.topics),
      });
      if (!parsed.success) {
        return noStoreJson(
          { error: 'Invalid note details.', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const note = await createAiNote({
        ...parsed.data,
        sourceType: parsed.data.sourceType as NoteSourceType | undefined,
      });
      return noStoreJson({ note }, { status: 201 });
    }

    const form = await req.formData();
    const fileEntry = form.get('file');
    const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
    const pastedText = typeof form.get('content') === 'string' ? String(form.get('content')) : '';
    const extracted = file ? await extractText(file) : pastedText;
    const content = extracted.replace(/\u0000/g, '');

    if (file && !content.trim()) {
      return noStoreJson(
        { error: 'The uploaded file did not contain readable text.' },
        { status: 400 },
      );
    }
    if (content.length > MAX_TEXT_CHARS) {
      return noStoreJson(
        { error: 'The extracted note is too large. Split it into smaller files.' },
        { status: 413 },
      );
    }

    const parsed = noteSchema.safeParse({
      title: nullableString(form.get('title')) || file?.name.replace(/\.[^.]+$/, '') || 'Untitled Page',
      notebookId: nullableString(form.get('notebookId')),
      course: nullableString(form.get('course')),
      semester: nullableString(form.get('semester')),
      section: nullableString(form.get('section')),
      classDate: nullableString(form.get('classDate')),
      sourceType: nullableString(form.get('sourceType')) || 'class-notes',
      topics: parseTopics(form.get('topics')),
      pinned: form.get('pinned') === 'true',
      content,
    });
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid note details.', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const note = await createAiNote({
      ...parsed.data,
      sourceType: parsed.data.sourceType as NoteSourceType,
      originalFilename: file?.name || null,
      mimeType: file?.type || (file ? 'application/octet-stream' : 'text/plain'),
    });

    return noStoreJson({ note }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save note.';
    const status = message.startsWith('Unsupported') ? 415 : message.includes('12 MB') ? 413 : 500;
    return noStoreJson({ error: message }, { status });
  }
}
