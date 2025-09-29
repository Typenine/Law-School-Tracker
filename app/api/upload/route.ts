import { ensureSchema, createTask } from '@/lib/storage';
import { parseSyllabusToTasks } from '@/lib/parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ensureSchema();
  // Dynamic imports to prevent build-time evaluation on Vercel
  const [{ default: pdfParse }, { default: mammoth }] = await Promise.all([
    import('pdf-parse'),
    import('mammoth'),
  ]);
  const form = await req.formData();
  const file = form.get('file');
  const course = (form.get('course') as string) || null;
  const mppRaw = (form.get('mpp') as string) || '';
  const minutesPerPage = (() => { const n = parseInt(mppRaw, 10); return isNaN(n) ? undefined : n; })();

  if (!(file instanceof File)) return new Response('file is required', { status: 400 });
  const arrayBuf = await file.arrayBuffer();
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

  const tasksToCreate = parseSyllabusToTasks(text, course, { minutesPerPage });
  const created = [] as any[];
  for (const t of tasksToCreate) {
    const c = await createTask(t);
    created.push(c);
  }
  return Response.json({ createdCount: created.length, tasks: created });
}
