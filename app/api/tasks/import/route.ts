import { ensureSchema, createTask } from '@/lib/storage';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function endOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  const header: string[] = [];
  let cur: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else { cell += ch; }
    } else {
      if (ch === '"') { quoted = true; }
      else if (ch === ',') { cur.push(cell); cell = ''; }
      else if (ch === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; }
      else if (ch === '\r') { /* ignore */ }
      else { cell += ch; }
    }
  }
  cur.push(cell);
  if (cur.length > 1 || (cur.length === 1 && cur[0].trim() !== '')) rows.push(cur);
  if (!rows.length) return { header: [], rows: [] };
  const hdr = rows.shift() as string[];
  for (const h of hdr) header.push(h.trim());
  return { header, rows };
}

export async function POST(req: Request) {
  await ensureSchema();
  const ct = req.headers.get('content-type') || '';
  let csvText = '';
  if (ct.includes('multipart/form-data')) {
    const fd = await (req as any).formData();
    const file = fd.get('file') as File | null;
    if (!file) return new Response('Missing file', { status: 400 });
    csvText = await file.text();
  } else {
    csvText = await req.text();
  }
  if (!csvText) return new Response('Empty CSV', { status: 400 });

  const { header, rows } = parseCsv(csvText);
  if (!header.length) return new Response('Invalid CSV header', { status: 400 });
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const col = {
    title: idx('title'),
    course: idx('course'),
    dueDate: idx('dueDate') >= 0 ? idx('dueDate') : idx('due'),
    status: idx('status'),
    est: idx('estimatedMinutes') >= 0 ? idx('estimatedMinutes') : idx('estimate'),
    priority: idx('priority'),
    notes: idx('notes'),
  };
  if (col.title < 0 || col.dueDate < 0) return new Response('CSV requires at least title,dueDate columns', { status: 400 });

  const schema = z.object({
    title: z.string().min(1),
    course: z.string().nullable().optional(),
    dueDate: z.string().min(1),
    status: z.enum(['todo', 'done']).optional(),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().nullable().optional(),
  });

  let created = 0;
  for (const r of rows) {
    try {
      const rawTitle = r[col.title] ?? '';
      const rawCourse = col.course >= 0 ? (r[col.course] ?? '') : '';
      const rawDue = r[col.dueDate] ?? '';
      const rawStatus = col.status >= 0 ? (r[col.status] ?? '') : '';
      const rawEst = col.est >= 0 ? (r[col.est] ?? '') : '';
      const rawPri = col.priority >= 0 ? (r[col.priority] ?? '') : '';
      const rawNotes = col.notes >= 0 ? (r[col.notes] ?? '') : '';

      const due = new Date(rawDue);
      if (isNaN(due.getTime())) continue;
      const dueIso = endOfDayLocal(due).toISOString();

      const obj = {
        title: String(rawTitle).trim(),
        course: String(rawCourse).trim() || null,
        dueDate: dueIso,
        status: rawStatus === 'done' ? 'done' as const : 'todo' as const,
        estimatedMinutes: rawEst ? parseInt(String(rawEst), 10) : null,
        priority: rawPri ? Math.min(5, Math.max(1, parseInt(String(rawPri), 10))) : null,
        notes: String(rawNotes).trim() || null,
      };
      const parsed = schema.safeParse(obj);
      if (!parsed.success) continue;
      await createTask(parsed.data);
      created++;
    } catch {}
  }

  return Response.json({ created }, { status: 201 });
}
