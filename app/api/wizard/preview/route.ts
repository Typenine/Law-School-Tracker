import { ensureSchema } from '@/lib/storage';
import { buildWizardPreview } from '@/lib/wizard_parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  await ensureSchema();
  const [{ default: pdfParse }, { default: mammoth }] = await Promise.all([
    import('pdf-parse'),
    import('mammoth'),
  ]);
  const form = await req.formData();
  const file = form.get('file');
  const course = (form.get('course') as string) || null;
  const timezone = (form.get('timezone') as string) || 'America/Chicago';
  const referenceDate = (form.get('referenceDate') as string) || undefined;
  const minutesPerPage = Number(form.get('minutesPerPage') || 3);

  if (!(file instanceof File)) return new Response('file is required', { status: 400 });
  if (file.size > MAX_FILE_BYTES) return new Response('File is too large. Maximum size is 20 MB.', { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  let text = '';
  let pageCount: number | null = null;

  try {
    if ((file.type || '').includes('pdf') || lowerName.endsWith('.pdf')) {
      const result = await pdfParse(buffer);
      text = result.text || '';
      pageCount = result.numpages || null;
    } else if ((file.type || '').includes('word') || lowerName.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } else if ((file.type || '').includes('text') || lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.csv')) {
      text = buffer.toString('utf8');
    } else {
      return new Response('Unsupported file type. Upload PDF, DOCX, TXT, Markdown, or CSV.', { status: 415 });
    }
  } catch (error: any) {
    return new Response(`Unable to read document: ${error?.message || 'unknown extraction error'}`, { status: 422 });
  }

  if (!text.trim()) return new Response('No selectable text was found. The document may be scanned or image-only and needs OCR before import.', { status: 422 });

  const preview = buildWizardPreview(text, course, {
    timezone,
    referenceDate,
    minutesPerPage: Number.isFinite(minutesPerPage) && minutesPerPage > 0 ? minutesPerPage : 3,
  });

  const sessionRows = preview.sessions.map(session => [
    session.date,
    session.topic || (session.canceled ? 'No class' : ''),
    session.readings.map(reading => [reading.short_title, reading.pages].filter(Boolean).join(' ')).join('; '),
    session.assignments_due.map(task => task.title).join('; '),
  ]);

  const rawLines = text.split(/\r?\n/);
  const rawRows: string[][] = [];
  for (const original of rawLines) {
    const line = original.trim();
    if (!line) continue;
    let cells: string[] = [];
    if (original.includes('|')) cells = original.split('|').map(cell => cell.trim());
    else if (/\t/.test(original)) cells = original.split(/\t+/).map(cell => cell.trim());
    else if (/\s{3,}/.test(original)) cells = original.split(/\s{3,}/).map(cell => cell.trim()).filter(Boolean);
    if (cells.length >= 2) rawRows.push(cells);
    if (rawRows.length >= 250) break;
  }

  return Response.json({
    preview,
    file: { name: file.name, size: file.size, type: file.type || null, pageCount },
    lines: rawLines.slice(0, 500),
    tables: [{ rows: sessionRows }, ...(rawRows.length ? [{ rows: rawRows }] : [])],
  });
}
