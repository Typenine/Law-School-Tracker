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
function formatLocalDT(d: Date) {
  // floating local time (no TZID). Many clients treat as local clock time
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
  const origin = url.origin;
  const timed = url.searchParams.get('timed') === '1';

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
    if (timed) {
      const baseStart = new Date(due);
      baseStart.setHours(9, 0, 0, 0); // 09:00
      const total = (typeof t.estimatedMinutes === 'number' && t.estimatedMinutes > 0) ? t.estimatedMinutes : 60;
      const CHUNK = 90; // minutes
      const chunks = Math.min(2, Math.max(1, Math.ceil(total / CHUNK)));
      let remaining = total;
      let cursor = new Date(baseStart);
      for (let i = 0; i < chunks; i++) {
        const dur = Math.min(remaining, CHUNK);
        const start = new Date(cursor);
        const end = new Date(start.getTime() + dur * 60000);
        const uid = `${t.id}-${i}@law-school-tracker`;
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${dtstamp}`);
        lines.push(`DTSTART:${formatLocalDT(start)}`);
        lines.push(`DTEND:${formatLocalDT(end)}`);
        lines.push(`SUMMARY:${summary}`);
        lines.push(`DESCRIPTION:${desc}`);
        lines.push(`URL:${origin}`);
        // 24-hour prior reminder
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:Task due soon');
        lines.push('TRIGGER:-PT24H');
        lines.push('END:VALARM');
        lines.push('END:VEVENT');
        remaining -= dur;
        cursor = end; // contiguous blocks
        if (remaining <= 0) break;
      }
    } else {
      const uid = `${t.id}@law-school-tracker`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
      lines.push(`SUMMARY:${summary}`);
      lines.push(`DESCRIPTION:${desc}`);
      lines.push(`URL:${origin}`);
      // 24-hour prior reminder
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:Task due soon');
      lines.push('TRIGGER:-PT24H');
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    }
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
