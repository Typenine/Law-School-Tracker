import { ensureSchema } from '@/lib/storage';
import { buildWizardPreview } from '@/lib/wizard_parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ensureSchema();
  const [{ default: pdfParse }, { default: mammoth }] = await Promise.all([
    import('pdf-parse'),
    import('mammoth'),
  ]);
  const form = await req.formData();
  const file = form.get('file');
  const ics = form.get('ics'); // optional
  const course = (form.get('course') as string) || null;
  const tz = (form.get('timezone') as string) || 'America/Chicago';

  if (!(file instanceof File)) return new Response('file is required', { status: 400 });

  async function readAsText(f: File): Promise<string> {
    const buf = Buffer.from(await f.arrayBuffer());
    const contentType = f.type || '';
    if (contentType.includes('pdf') || f.name.toLowerCase().endsWith('.pdf')) {
      const res = await pdfParse(buf);
      return res.text || '';
    }
    if (contentType.includes('word') || f.name.toLowerCase().endsWith('.docx')) {
      const res = await mammoth.extractRawText({ buffer: buf });
      return res.value || '';
    }
    if (contentType.includes('text') || f.name.toLowerCase().endsWith('.txt')) {
      return buf.toString('utf8');
    }
    return '';
  }

  let text = await readAsText(file as File);
  // TODO: optional: parse ICS to anchor dates (future work). Currently unused.
  if (!text || text.trim().length === 0) return new Response('Unable to extract text from file', { status: 400 });

  const preview = buildWizardPreview(text, course, { timezone: tz });
  // Provide raw lines and best-effort table-like rows for Mapping
  const rawLines = text.split(/\r?\n/);
  const tables: Array<{ rows: string[][] } > = [];
  for (const ln of rawLines) {
    const line = ln; // keep spacing for 3+ space splits
    const trimmed = line.trim();
    if (!trimmed) continue;
    let cells: string[] | null = null;
    if (line.includes('|')) {
      cells = line.split('|').map(c => c.trim());
    } else if (/\t/.test(line)) {
      cells = line.split(/\t+/).map(c => c.trim());
    } else if (/\s{3,}/.test(line)) {
      // columns separated by 3+ spaces (common in PDF text)
      const parts = line.split(/\s{3,}/).map(c => c.trim()).filter(Boolean);
      if (parts.length >= 2) cells = parts;
    } else {
      // Line starting with a date → [date, rest]
      const p = (await import('chrono-node')).parse(line, new Date(), { forwardDate: true });
      if (p.length) {
        const r = p[0];
        const idx = (r as any).index ?? line.toLowerCase().indexOf(r.text.toLowerCase());
        if (idx !== undefined && idx <= 5) {
          const dateText = r.text;
          const after = line.slice(idx + dateText.length).trim();
          const before = line.slice(0, idx).trim();
          const arr = [dateText, after].filter(Boolean);
          if (arr.length >= 1) cells = arr.length === 1 ? [arr[0], ''] : arr;
        }
      }
    }
    if (cells && cells.filter(Boolean).length >= 1) tables.push({ rows: [cells] });
    if (tables.length >= 300) break;
  }
  return Response.json({ preview, lines: rawLines.slice(0, 300), tables });
}
