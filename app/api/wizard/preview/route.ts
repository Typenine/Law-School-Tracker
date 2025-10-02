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
  // Provide raw lines (trimmed) for mapping UI and a basic table candidate set
  const lines = text.split(/\r?\n/).slice(0, 500);
  const tables: Array<{ rows: string[][] } > = [];
  for (const ln of lines) {
    if (!ln) continue;
    if (ln.includes('|')) {
      const cells = ln.split('|').map(c => c.trim());
      if (cells.filter(Boolean).length >= 2) tables.push({ rows: [cells] });
    } else if (/\t/.test(ln)) {
      const cells = ln.split(/\t+/).map(c => c.trim());
      if (cells.filter(Boolean).length >= 2) tables.push({ rows: [cells] });
    }
    if (tables.length >= 100) break;
  }
  return Response.json({ preview, lines: lines.slice(0, 300), tables });
}
