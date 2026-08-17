
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { StudySession, Task } from './types';
import { countPages, formatPageRanges, parsePageRanges, subtractPages, validateCompletedPages } from './pageRanges';
import { canonicalPageRanges, courseReadingPace, readingMetrics, taskOriginalRanges, taskRemainingRanges } from './reading';
import { createSession, listCourses, listScheduleBlocks, listSessions, listTasks, recomputeLearnedMppForCourse, replaceAllScheduleBlocks, updateTask } from './storage';

export type TaskProgressInput = {
  mode: 'partial' | 'finish';
  minutes: number;
  focus: number;
  notes?: string | null;
  pagesCompleted?: string | null;
  moveToDay?: string | null;
  completionDate?: string | null;
};

function resolveDbUrl(): string | null {
  const direct = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || null;
  if (direct) return direct;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env as Record<string, string | undefined>;
  if (PGHOST && PGUSER && PGPASSWORD && PGDATABASE) {
    const port = PGPORT ? `:${PGPORT}` : '';
    return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${port}/${PGDATABASE}?sslmode=require`;
  }
  return null;
}

const DB_URL = resolveDbUrl();
let pool: Pool | null = null;
function getPool(): Pool {
  if (!DB_URL) throw new Error('No database URL');
  if (!pool) pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  return pool;
}

function rowToTask(r: any): Task {
  return {
    id: r.id, title: r.title, course: r.course ?? null, courseId: r.course_id ?? null,
    dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(),
    startTime: r.start_time ?? null, endTime: r.end_time ?? null, estimatedMinutes: r.estimated_minutes ?? null,
    estimateOrigin: r.estimate_origin ?? null, actualMinutes: r.actual_minutes ?? null, priority: r.priority ?? null,
    notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null, tags: r.tags ?? null,
    term: r.term ?? null, completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    focus: r.focus ?? null, pagesRead: r.pages_read ?? null, activity: r.activity ?? null,
    originalPageRanges: r.original_page_ranges ?? null, remainingPageRanges: r.remaining_page_ranges ?? null,
  };
}

function sessionFromRow(r: any): StudySession {
  return { id: r.id, taskId: r.task_id ?? null, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus ?? null, notes: r.notes ?? null, pagesRead: r.pages_read ?? null, outlinePages: r.outline_pages ?? null, practiceQs: r.practice_qs ?? null, activity: r.activity ?? null, createdAt: new Date(r.created_at).toISOString() };
}

function completionDate(input: TaskProgressInput): Date {
  if (input.completionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.completionDate)) return new Date(`${input.completionDate}T12:00:00`);
  return new Date();
}

export async function recordTaskProgress(taskId: string, input: TaskProgressInput): Promise<{ task: Task; session: StudySession; reading: ReturnType<typeof readingMetrics> }> {
  if (DB_URL) return recordDb(taskId, input);
  return recordFallback(taskId, input);
}

async function recordDb(taskId: string, input: TaskProgressInput) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(`SELECT id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, priority, notes, attachments, depends_on, tags, term, completed_at, focus, pages_read, activity, start_time, end_time, original_page_ranges, remaining_page_ranges FROM tasks WHERE id=$1 FOR UPDATE`, [taskId]);
    if (!taskRes.rowCount) throw Object.assign(new Error('Task not found'), { status: 404 });
    const task = rowToTask(taskRes.rows[0]);
    const courseRes = await client.query(`SELECT id, title, code, learned_mpp, override_enabled, override_mpp, created_at FROM courses WHERE id=$1 OR lower(title)=lower($2) OR lower(COALESCE(code,''))=lower($2) ORDER BY CASE WHEN id=$1 THEN 0 ELSE 1 END LIMIT 1`, [task.courseId, task.course || '']);
    const course = courseRes.rows[0] ? [{ id: courseRes.rows[0].id, title: courseRes.rows[0].title, code: courseRes.rows[0].code, learnedMpp: courseRes.rows[0].learned_mpp, overrideEnabled: courseRes.rows[0].override_enabled, overrideMpp: courseRes.rows[0].override_mpp, createdAt: new Date(courseRes.rows[0].created_at).toISOString() } as any] : [];
    const pace = courseReadingPace(task.course, course);
    const original = taskOriginalRanges(task);
    const remainingBefore = taskRemainingRanges(task);
    const isReading = task.activity === 'reading' || Boolean(original || remainingBefore);
    let completedInput = canonicalPageRanges(input.pagesCompleted) || null;
    if (isReading && input.mode === 'finish') completedInput = remainingBefore || original;
    let remainingAfter = remainingBefore;
    let pagesThisSession = 0;
    if (isReading && completedInput && remainingBefore) {
      const currentRanges = parsePageRanges(remainingBefore);
      const valid = validateCompletedPages(currentRanges, completedInput);
      if (!valid.valid) throw Object.assign(new Error(valid.error || 'Completed pages are outside the assigned range.'), { status: 400 });
      pagesThisSession = countPages(parsePageRanges(completedInput));
      remainingAfter = formatPageRanges(subtractPages(currentRanges, completedInput)) || null;
    }
    const remainingPages = remainingAfter ? countPages(parsePageRanges(remainingAfter)) : 0;
    const done = input.mode === 'finish' || (isReading && Boolean(original) && remainingPages === 0);
    const prior = await client.query(`SELECT COALESCE(SUM(minutes),0)::int AS minutes FROM sessions WHERE task_id=$1`, [taskId]);
    const totalLogged = Number(prior.rows[0]?.minutes || 0) + input.minutes;
    const when = completionDate(input);
    const sessionId = randomUUID();
    const sessionRes = await client.query(`INSERT INTO sessions (id, task_id, when_ts, minutes, focus, notes, pages_read, activity, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at`, [sessionId, taskId, when, input.minutes, input.focus, input.notes || null, pagesThisSession || null, task.activity || (isReading ? 'reading' : null)]);
    const estimated = done ? 0 : isReading && remainingPages > 0 ? Math.max(1, Math.round(remainingPages * pace.mpp)) : Math.max(0, (Number(task.estimatedMinutes) || 0) - input.minutes);
    const updatedRes = await client.query(`UPDATE tasks SET original_page_ranges=$2, remaining_page_ranges=$3, estimated_minutes=$4, status=$5, actual_minutes=$6, focus=$7, completed_at=$8 WHERE id=$1 RETURNING id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, priority, notes, attachments, depends_on, tags, term, completed_at, focus, pages_read, activity, start_time, end_time, original_page_ranges, remaining_page_ranges`, [taskId, original, done ? null : remainingAfter, estimated, done ? 'done' : task.status, done ? totalLogged : task.actualMinutes ?? null, done ? Math.round(input.focus) : task.focus ?? null, done ? when : task.completedAt ? new Date(task.completedAt) : null]);
    if (done) {
      await client.query(`DELETE FROM schedule_blocks WHERE task_id=$1`, [taskId]);
    } else if (input.moveToDay && /^\d{4}-\d{2}-\d{2}$/.test(input.moveToDay)) {
      await client.query(`DELETE FROM schedule_blocks WHERE task_id=$1`, [taskId]);
      await client.query(`INSERT INTO schedule_blocks (id, task_id, day, planned_minutes, guessed, title, course, pages, priority, catchup) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,FALSE)`, [`progress-${randomUUID()}`, taskId, input.moveToDay, estimated, pace.source === 'default', task.title, task.course || '', remainingPages || null, task.priority ?? null]);
    }
    await client.query('COMMIT');
    if (pagesThisSession > 0 && task.course) await recomputeLearnedMppForCourse(task.course).catch(() => undefined);
    const updated = rowToTask(updatedRes.rows[0]);
    const session = sessionFromRow(sessionRes.rows[0]);
    const reading = readingMetrics(updated, [{ ...session }], course);
    reading.loggedMinutes = totalLogged;
    return { task: updated, session, reading };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function recordFallback(taskId: string, input: TaskProgressInput) {
  const tasks = await listTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const [courses, sessions] = await Promise.all([listCourses(), listSessions()]);
  const pace = courseReadingPace(task.course, courses);
  const original = taskOriginalRanges(task);
  const remainingBefore = taskRemainingRanges(task);
  const isReading = task.activity === 'reading' || Boolean(original || remainingBefore);
  let completedInput = canonicalPageRanges(input.pagesCompleted) || null;
  if (isReading && input.mode === 'finish') completedInput = remainingBefore || original;
  let remainingAfter = remainingBefore;
  let pagesThisSession = 0;
  if (isReading && completedInput && remainingBefore) {
    const currentRanges = parsePageRanges(remainingBefore);
    const valid = validateCompletedPages(currentRanges, completedInput);
    if (!valid.valid) throw Object.assign(new Error(valid.error || 'Completed pages are outside the assigned range.'), { status: 400 });
    pagesThisSession = countPages(parsePageRanges(completedInput));
    remainingAfter = formatPageRanges(subtractPages(currentRanges, completedInput)) || null;
  }
  const remainingPages = remainingAfter ? countPages(parsePageRanges(remainingAfter)) : 0;
  const done = input.mode === 'finish' || (isReading && Boolean(original) && remainingPages === 0);
  const session = await createSession({ taskId, minutes: input.minutes, focus: input.focus, notes: input.notes || null, pagesRead: pagesThisSession || null, activity: task.activity || (isReading ? 'reading' : null), when: completionDate(input).toISOString() });
  const totalLogged = sessions.filter(s => s.taskId === taskId).reduce((sum, s) => sum + s.minutes, 0) + input.minutes;
  const estimated = done ? 0 : isReading && remainingPages > 0 ? Math.max(1, Math.round(remainingPages * pace.mpp)) : Math.max(0, (task.estimatedMinutes || 0) - input.minutes);
  const updated = await updateTask(taskId, { originalPageRanges: original, remainingPageRanges: done ? null : remainingAfter, estimatedMinutes: estimated, status: done ? 'done' : task.status, actualMinutes: done ? totalLogged : task.actualMinutes ?? null, focus: done ? Math.round(input.focus) : task.focus ?? null, completedAt: done ? completionDate(input).toISOString() : task.completedAt ?? null });
  if (!updated) throw new Error('Unable to update task');
  const blocks = await listScheduleBlocks();
  if (done) await replaceAllScheduleBlocks(blocks.filter(b => b.taskId !== taskId));
  else if (input.moveToDay && /^\d{4}-\d{2}-\d{2}$/.test(input.moveToDay)) await replaceAllScheduleBlocks([...blocks.filter(b => b.taskId !== taskId), { id: `progress-${randomUUID()}`, taskId, day: input.moveToDay, plannedMinutes: estimated, guessed: pace.source === 'default', title: task.title, course: task.course || '', pages: remainingPages || null, priority: task.priority ?? null, catchup: false }]);
  return { task: updated, session, reading: readingMetrics(updated, [...sessions, session], courses) };
}
