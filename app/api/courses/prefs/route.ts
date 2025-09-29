import { ensureSchema, listSessions, listTasks } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Returns per-course estimate scale based on logged vs estimated minutes (last 60 days)
export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const courseQ = (url.searchParams.get('course') || '').trim().toLowerCase();
  const tasks = await listTasks();
  const sessions = await listSessions();
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days
  const taskById = new Map(tasks.map(t => [t.id, t] as const));

  const sums = new Map<string, { est: number; logged: number }>();
  for (const t of tasks) {
    const c = (t.course || '').toLowerCase();
    if (!c) continue;
    if (!sums.has(c)) sums.set(c, { est: 0, logged: 0 });
    const row = sums.get(c)!;
    row.est += (t.estimatedMinutes || 0);
  }
  for (const s of sessions) {
    const when = new Date(s.when);
    if (when < cutoff) continue;
    const t = s.taskId ? taskById.get(s.taskId) : undefined;
    const c = (t?.course || '').toLowerCase();
    if (!c) continue;
    if (!sums.has(c)) sums.set(c, { est: 0, logged: 0 });
    const row = sums.get(c)!;
    row.logged += (s.minutes || 0);
  }
  const payload: Array<{ course: string; estScale: number }> = [];
  for (const [c, v] of sums) {
    const scale = v.est > 0 ? Math.max(0.5, Math.min(2.0, v.logged / v.est)) : 1;
    payload.push({ course: c, estScale: Number(scale.toFixed(2)) });
  }
  if (courseQ) {
    const found = payload.find(p => p.course === courseQ);
    return Response.json(found || { course: courseQ, estScale: 1 });
  }
  return Response.json({ courses: payload });
}
