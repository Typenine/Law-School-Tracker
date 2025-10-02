import { ensureSchema, createTask, createCourse, listCourses, updateCourse } from '@/lib/storage';
import { parseSyllabusToTasks, parseSyllabusToCourseMeta } from '@/lib/parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ensureSchema();
  // Dynamic imports to prevent build-time evaluation on Vercel
  const [{ default: pdfParse }, { default: mammoth }] = await Promise.all([
    import('pdf-parse'),
    import('mammoth'),
  ]);
  const u = new URL(req.url);
  const preview = u.searchParams.get('preview') === '1';
  const form = await req.formData();
  const file = form.get('file');
  const course = (form.get('course') as string) || null;
  const mppRaw = (form.get('mpp') as string) || '';
  const minutesPerPage = (() => { const n = parseInt(mppRaw, 10); return isNaN(n) ? undefined : n; })();
  const extractTasks = (() => { const v = form.get('extractTasks'); return v === '1' || v === 'true'; })();

  if (!(file instanceof File)) return new Response('file is required', { status: 400 });
  const arrayBuf = await (file as File).arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  const contentType = file.type || '';
  let text = '';
  try {
    if (contentType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
      const res = await pdfParse(buffer);
      text = res.text || '';
    } else if (contentType.includes('word') || file.name.toLowerCase().endsWith('.docx')) {
      const res = await mammoth.extractRawText({ buffer });
      text = res.value || '';
    } else if (contentType.includes('text') || file.name.toLowerCase().endsWith('.txt')) {
      text = buffer.toString('utf8');
    } else {
      return new Response('Unsupported file type', { status: 415 });
    }
  } catch (e: any) {
    return new Response('Failed to read file: ' + e.message, { status: 400 });
  }

  // OCR fallback for scanned PDFs if enabled and text is too short
  async function ocrSpaceExtract(f: File): Promise<string> {
    const key = process.env.OCR_SPACE_API_KEY;
    if (!key) return '';
    try {
      const fd = new FormData();
      fd.append('language', 'eng');
      fd.append('isOverlayRequired', 'false');
      fd.append('OCREngine', '2');
      fd.append('file', f, f.name);
      const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', headers: { apikey: key }, body: fd });
      if (!resp.ok) return '';
      const data = await resp.json();
      const parts = Array.isArray(data?.ParsedResults) ? data.ParsedResults.map((p: any) => p?.ParsedText || '').filter(Boolean) : [];
      return parts.join('\n');
    } catch {
      return '';
    }
  }
  if ((contentType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) && (!text || text.trim().length < 20)) {
    const ocrText = await ocrSpaceExtract(file as File);
    if (ocrText && ocrText.trim().length > 0) text = ocrText;
  }

  const meta = (() => { try { return parseSyllabusToCourseMeta(text, course); } catch { return null; } })();
  const tasksToCreate = extractTasks ? parseSyllabusToTasks(text, course, { minutesPerPage }) : [];
  if (preview) {
    // Prepare course merge preview
    let existing: any = null; let changes: string[] = [];
    if (meta && meta.title) {
      const all = await listCourses();
      existing = all.find(c => (
        (meta.code && c.code && c.code.toLowerCase() === meta.code.toLowerCase()) ||
        (meta.title && c.title.toLowerCase() === meta.title.toLowerCase())
      ) && (
        (!meta.year || c.year === meta.year) && (!meta.semester || c.semester === meta.semester)
      )) || null;
      if (existing) {
        const keys = ['code','title','instructor','instructorEmail','room','location','meetingDays','meetingStart','meetingEnd','meetingBlocks','startDate','endDate','semester','year'] as const;
        for (const k of keys) {
          const a = (existing as any)[k];
          const b = (meta as any)[k];
          const same = JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
          if (!same && b !== undefined) changes.push(k as string);
        }
      } else {
        const keys = ['code','title','instructor','instructorEmail','room','location','meetingDays','meetingStart','meetingEnd','meetingBlocks','startDate','endDate','semester','year'] as const;
        for (const k of keys) if ((meta as any)[k] !== undefined && (meta as any)[k] !== null) changes.push(k as string);
      }
    }
    return Response.json({ preview: true, tasks: tasksToCreate, coursePreview: { hasMeta: !!meta, proposed: meta, existing, changes } });
  }

  // Non-preview: upsert course metadata
  try {
    if (meta && meta.title) {
      const existing = (await listCourses()).find(c => (
        (meta.code && c.code && c.code.toLowerCase() === meta.code.toLowerCase()) ||
        (meta.title && c.title.toLowerCase() === meta.title.toLowerCase())
      ) && (
        (!meta.year || c.year === meta.year) && (!meta.semester || c.semester === meta.semester)
      ));
      if (existing) {
        await updateCourse(existing.id, meta);
      } else {
        await createCourse(meta);
      }
    }
  } catch {}

  const created = [] as any[];
  if (extractTasks) {
    for (const t of tasksToCreate) {
      const c = await createTask(t);
      created.push(c);
    }
  }
  return Response.json({ createdCount: created.length, tasks: created, courseUpdated: !!meta });
}
