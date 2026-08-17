import { ensureSchema } from '@/lib/storage';
import { ensureTaskV2Schema, listVisibleTasks } from '@/lib/taskV2';
import { createHmac } from 'crypto';

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
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export async function GET(req: Request) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const url = new URL(req.url);
  const requiredToken = process.env.ICS_PRIVATE_TOKEN;
  if (requiredToken) {
    const token = url.searchParams.get('token') || '';
    if (token !== requiredToken) return new Response('Unauthorized', { status: 401 });
  }
  const course = (url.searchParams.get('course') || '').trim().toLowerCase();
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();
  const origin = url.origin;
  const timed = url.searchParams.get('timed') === '1';
  const toggleSecret = process.env.ICS_TOGGLE_SECRET || process.env.ICS_PRIVATE_TOKEN || '';

  let tasks = await listVisibleTasks({ includeBlocked: true });
  if (course) tasks = tasks.filter(t => (t.course || '').toLowerCase().includes(course));
  if (status === 'todo' || status === 'done') tasks = tasks.filter(t => t.status === status);

  const now = new Date();
  const dtstamp = formatStampUTC(now);
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LawSchoolTracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

  for (const t of tasks) {
    const due = new Date(t.dueDate);
    const dateStr = formatDateUTC(due);
    const summary = icsEscape(t.title);
    const details = `${t.course ? `[${t.course}] ` : ''}${t.title}${t.estimatedMinutes ? ` (est ${t.estimatedMinutes}m)` : ''}`;
    const desc = icsEscape(details);
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    const payload = `${t.id}:${exp}`;
    const sig = toggleSecret ? createHmac('sha256', toggleSecret).update(payload).digest('hex') : '';
    const toggleUrl = sig ? `${origin}/api/tasks/${t.id}/toggle?exp=${exp}&sig=${sig}` : origin;
    if (timed) {
      const baseStart = new Date(due); baseStart.setHours(9, 0, 0, 0);
      const total = typeof t.estimatedMinutes === 'number' && t.estimatedMinutes > 0 ? t.estimatedMinutes : 60;
      const chunkSize = 90;
      const chunks = Math.min(2, Math.max(1, Math.ceil(total / chunkSize)));
      let remaining = total;
      let cursor = new Date(baseStart);
      for (let i = 0; i < chunks; i++) {
        const dur = Math.min(remaining, chunkSize);
        const start = new Date(cursor);
        const end = new Date(start.getTime() + dur * 60000);
        lines.push('BEGIN:VEVENT', `UID:${t.id}-${i}@law-school-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${formatLocalDT(start)}`, `DTEND:${formatLocalDT(end)}`, `SUMMARY:${summary}`, `DESCRIPTION:${desc}`, `URL:${origin}`, `X-ALT-DESC;FMTTYPE=text/html:${icsEscape(`<a href="${toggleUrl}">Toggle Done</a>`)}`, `X-LST-Toggle:${toggleUrl}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Task due soon', 'TRIGGER:-PT24H', 'END:VALARM', 'END:VEVENT');
        remaining -= dur;
        cursor = end;
        if (remaining <= 0) break;
      }
    } else {
      lines.push('BEGIN:VEVENT', `UID:${t.id}@law-school-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${dateStr}`, `SUMMARY:${summary}`, `DESCRIPTION:${desc}`, `URL:${origin}`, `X-ALT-DESC;FMTTYPE=text/html:${icsEscape(`<a href="${toggleUrl}">Toggle Done</a>`)}`, `X-LST-Toggle:${toggleUrl}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Task due soon', 'TRIGGER:-PT24H', 'END:VALARM', 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="law-school-tasks.ics"' } });
}
