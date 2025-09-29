import { ensureSchema, listTasks } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pad(n: number) { return String(n).padStart(2, '0'); }
function formatDateUTC(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function formatStampUTC(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const requiredToken = process.env.ICS_PRIVATE_TOKEN;
  if (requiredToken) {
    const token = url.searchParams.get('token') || '';
    if (token !== requiredToken) {
      return new Response('Unauthorized', { status: 401 });
    }
  }
  const course = (url.searchParams.get('course') || '').trim().toLowerCase();
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();

  let tasks = await listTasks();
  if (course) tasks = tasks.filter(t => (t.course || '').toLowerCase().includes(course));
  if (status === 'todo' || status === 'done') tasks = tasks.filter(t => t.status === status);

  const now = new Date();
  const dtstamp = formatStampUTC(now);

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//LawSchoolTracker//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  for (const t of tasks) {
    const due = new Date(t.dueDate);
    const dateStr = formatDateUTC(due);
    const summary = icsEscape(t.title);
    const details = `${t.course ? `[${t.course}] ` : ''}${t.title}${t.estimatedMinutes ? ` (est ${t.estimatedMinutes}m)` : ''}`;
    const desc = icsEscape(details);
    const uid = `${t.id}@law-school-tracker`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:${desc}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  const body = lines.join('\r\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="law-school-tasks.ics"',
    },
  });
}
