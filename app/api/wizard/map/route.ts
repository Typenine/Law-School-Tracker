import { ensureSchema } from '@/lib/storage';
import * as chrono from 'chrono-node';
import { endOfDay } from 'date-fns';
import type { WizardPreview, Session, Reading, WizardTask } from '@/lib/wizard_types';
import type { ReadingPriority, TaskType } from '@/lib/wizard_types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pagesOrSections(line: string): string | null {
  const m = /(pp?\.)\s*[^;,.]+|\bpages?\s*[^;,.]+|\bch(?:apter)?\.?\s*\d+(?:\s*[-–—]\s*\d+)?|§+\s*[^;,.]+/i.exec(line);
  return m ? m[0] : null;
}

function detectReadingPriority(line: string): ReadingPriority {
  const l = line.toLowerCase();
  if (/\bskim\b/.test(l)) return 'skim';
  if (/\boptional\b/.test(l)) return 'optional';
  return 'required';
}

function classifyTask(line: string): TaskType {
  const l = line.toLowerCase();
  if (l.includes('brief') && l.includes('case')) return 'brief';
  if (l.includes('memo')) return 'memo';
  if (l.includes('quiz')) return 'quiz';
  if (l.includes('exam') || l.includes('midterm') || l.includes('final')) return 'exam';
  if (/(submit|due|turn in|upload)/i.test(line)) return 'admin';
  return 'reading';
}

function isBullet(line: string) { return /^\s*(?:[-–—•*]|\d+[).])\s+/.test(line); }
function confidence(base: number, ...mods: number[]): number { let c = base; for (const m of mods) c += m; return Math.max(0, Math.min(1, c)); }

export async function POST(req: Request) {
  await ensureSchema();
  let body: any;
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const rows: string[][] = Array.isArray(body?.rows) ? body.rows : [];
  const map = body?.mapping || {};
  const tz = (body?.timezone as string) || 'America/Chicago';
  const dateCol = Number.isInteger(map.dateCol) ? map.dateCol : 0;
  const topicCol = Number.isInteger(map.topicCol) ? map.topicCol : 1;
  const readingsCol = Number.isInteger(map.readingsCol) ? map.readingsCol : 2;
  const assignmentsCol = Number.isInteger(map.assignmentsCol) ? map.assignmentsCol : 3;

  const sessions: Session[] = [];
  const byDateKey = new Map<string, Session>();
  let seq = 1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const dc = (r[dateCol] || '').trim();
    const tp = (r[topicCol] || '').trim();
    const rd = (r[readingsCol] || '').trim();
    const as = (r[assignmentsCol] || '').trim();
    if (!dc && !tp && !rd && !as) continue;

    let when: Date | null = null;
    const ps = chrono.parse(dc, new Date(), { forwardDate: true });
    if (ps.length) {
      const p = ps[0];
      when = p.end ? p.end.date() : (p.start ? p.start.date() : p.date());
    }

    if (!when) {
      // Try alternative: date hidden in concatenated cell
      const p2 = chrono.parse([dc, tp, rd, as].filter(Boolean).join(' | '), new Date(), { forwardDate: true });
      if (p2.length) when = p2[0].end ? p2[0].end.date() : (p2[0].start ? p2[0].start.date() : p2[0].date());
    }

    if (!when) continue;
    const key = endOfDay(when).toISOString().slice(0,10);

    let s = byDateKey.get(key);
    if (!s) {
      s = { date: key, sequence_number: seq++, topic: null, readings: [], assignments_due: [], notes: null, canceled: /no class|cancell?ed/i.test(dc), source_ref: `row:${i}`, confidence: confidence(0.9) } as Session;
      byDateKey.set(key, s);
      sessions.push(s);
    }

    if (!s.topic && tp) s.topic = tp.slice(0, 180);

    if (rd) {
      const items = rd.split(/;|•|\u2022|\n/).map(x => x.trim()).filter(Boolean);
      for (const it of items) {
        const pg = pagesOrSections(it);
        if (!/(read|casebook|article|pp?\.|chapter|ch\.|§)/i.test(it) && !pg && !isBullet(it)) continue;
        const reading: Reading = {
          source_type: (/case\b/i.test(it) ? 'case' : /statute/i.test(it) ? 'statute' : /article|journal/i.test(it) ? 'article' : 'casebook'),
          short_title: it.replace(/^read(ing)?:?\s*/i, '').slice(0, 120) || null,
          pages: pg,
          priority: detectReadingPriority(it),
          source_ref: `row:${i}`,
          confidence: confidence(0.8, pg ? 0.1 : 0, isBullet(it) ? 0.05 : 0),
        };
        s.readings.push(reading);
      }
    }

    if (as) {
      const items = as.split(/;|•|\u2022|\n/).map(x => x.trim()).filter(Boolean);
      for (const it of items) {
        if (!/(due|submit|turn in|upload|brief|memo|quiz|exam|final|midterm|start of class|at class|by class time|11:59)/i.test(it)) continue;
        const startTime = '09:00'; // fallback; actual meeting_time will be applied later in the full wizard
        const startOfClass = /start of class|at class|by class time/i.test(it);
        const by1159 = /11:59\s*(?:pm)?/i.test(it) || /by end of day|by eod/i.test(it);
        const dtLocal = `${key}T${startOfClass ? startTime : (by1159 ? '23:59' : startTime)}:00`;
        const task: WizardTask = {
          type: classifyTask(it),
          title: it.slice(0, 160),
          due_datetime: dtLocal,
          estimated_minutes: null,
          blocking: /must|required|block/i.test(it),
          source_ref: `row:${i}`,
          status: 'planned',
          confidence: confidence(0.75, startOfClass || by1159 ? 0.1 : 0),
        };
        s.assignments_due.push(task);
      }
    }
  }

  const readings = sessions.flatMap(s => s.readings);
  const tasks = sessions.flatMap(s => s.assignments_due);
  const low: WizardPreview['lowConfidence'] = [];
  for (const s of sessions) if ((s.confidence ?? 1) < 0.8) low.push({ kind: 'session', ref: s.source_ref, confidence: s.confidence ?? 0.7 });
  for (const r of readings) if ((r.confidence ?? 1) < 0.8) low.push({ kind: 'reading', ref: r.source_ref, confidence: r.confidence ?? 0.7 });
  for (const t of tasks) if ((t.confidence ?? 1) < 0.8) low.push({ kind: 'task', ref: t.source_ref, confidence: t.confidence ?? 0.7 });

  const preview: WizardPreview = { course: null, sessions, readings, tasks, lowConfidence: low };
  return Response.json({ preview });
}
