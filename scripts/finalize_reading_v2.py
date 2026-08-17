from pathlib import Path

root = Path(__file__).resolve().parents[1]

p = root / 'lib/storage.ts'
text = p.read_text(encoding='utf-8')
text = text.replace('async function recomputeLearnedMppForCourse(courseTitle: string): Promise<void> {', 'export async function recomputeLearnedMppForCourse(courseTitle: string): Promise<void> {', 1)
p.write_text(text, encoding='utf-8')

p = root / 'lib/taskProgress.ts'
text = p.read_text(encoding='utf-8')
text = text.replace("import { createSession, listCourses, listScheduleBlocks, listSessions, listTasks, replaceAllScheduleBlocks, updateTask } from './storage';", "import { createSession, listCourses, listScheduleBlocks, listSessions, listTasks, recomputeLearnedMppForCourse, replaceAllScheduleBlocks, updateTask } from './storage';", 1)
text = text.replace("if (isReading && input.mode === 'finish' && !completedInput) completedInput = remainingBefore || original;", "if (isReading && input.mode === 'finish') completedInput = remainingBefore || original;", 2)
old = """    await client.query('COMMIT');
    const updated = rowToTask(updatedRes.rows[0]);
    const session = sessionFromRow(sessionRes.rows[0]);
    return { task: updated, session, reading: readingMetrics(updated, [{ ...session }], course) };"""
new = """    await client.query('COMMIT');
    if (pagesThisSession > 0 && task.course) await recomputeLearnedMppForCourse(task.course).catch(() => undefined);
    const updated = rowToTask(updatedRes.rows[0]);
    const session = sessionFromRow(sessionRes.rows[0]);
    const reading = readingMetrics(updated, [{ ...session }], course);
    reading.loggedMinutes = totalLogged;
    return { task: updated, session, reading };"""
if old not in text: raise RuntimeError('taskProgress anchor missing')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')

p = root / 'components/SiteChrome.tsx'
text = p.read_text(encoding='utf-8')
text = text.replace("  { href: '/tasks', icon: '✓', label: 'Tasks', count: 'tasks' },\n];", "  { href: '/tasks', icon: '✓', label: 'Tasks', count: 'tasks' },\n  { href: '/reading', icon: '▥', label: 'Reading' },\n];", 1)
text = text.replace("  '/tasks': ['Tasks', 'Assignments grouped around what needs attention.'],\n  '/courses':", "  '/tasks': ['Tasks', 'Assignments grouped around what needs attention.'],\n  '/reading': ['Reading', 'Assigned pages, progress, pace, linked notes, and the time still required.'],\n  '/courses':", 1)
p.write_text(text, encoding='utf-8')
