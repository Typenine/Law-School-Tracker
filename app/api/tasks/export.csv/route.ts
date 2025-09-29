import { ensureSchema, listTasks } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function csvEscape(val: any): string {
  const s = (val ?? '').toString();
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const course = (url.searchParams.get('course') || '').trim().toLowerCase();
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();

  let tasks = await listTasks();
  if (course) tasks = tasks.filter(t => (t.course || '').toLowerCase().includes(course));
  if (status === 'todo' || status === 'done') tasks = tasks.filter(t => t.status === status);

  const header = ['id','title','course','dueDate','status','estimatedMinutes','priority','notes'];
  const lines: string[] = [];
  lines.push(header.join(','));
  for (const t of tasks) {
    const row = [
      csvEscape(t.id),
      csvEscape(t.title),
      csvEscape(t.course ?? ''),
      csvEscape(t.dueDate),
      csvEscape(t.status),
      csvEscape(t.estimatedMinutes ?? ''),
      csvEscape(t.priority ?? ''),
      csvEscape(t.notes ?? ''),
    ];
    lines.push(row.join(','));
  }
  const body = lines.join('\r\n');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tasks.csv"' } });
}
