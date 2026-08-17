import type { StatsPayload } from './types';
import { listSessions } from './storage';
import { ensureTaskV2Schema, listVisibleTasks } from './taskV2';

export async function statsNowV2(): Promise<StatsPayload> {
  await ensureTaskV2Schema();
  const [tasks, sessions] = await Promise.all([
    listVisibleTasks({ includeBlocked: true }),
    listSessions(),
  ]);
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 864e5);
  const upcoming7d = tasks.filter(task => {
    const due = new Date(task.dueDate);
    return task.status !== 'done' && due >= now && due <= in7;
  }).length;

  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const weekSessions = sessions.filter(session => {
    const when = new Date(session.when);
    return when >= monday && when <= sunday;
  });
  const totalMinutes = weekSessions.reduce((sum, session) => sum + (session.minutes || 0), 0);
  const hoursThisWeek = Math.round((totalMinutes / 60) * 10) / 10;
  const focusVals = weekSessions.map(session => session.focus).filter((value): value is number => typeof value === 'number');
  const avgFocusThisWeek = focusVals.length ? Math.round((focusVals.reduce((a, b) => a + b, 0) / focusVals.length) * 10) / 10 : null;

  const weekTodos = tasks.filter(task => task.status !== 'done' && new Date(task.dueDate) >= monday && new Date(task.dueDate) <= sunday);
  const estMinutesThisWeek = weekTodos.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);
  const loggedMinutesThisWeek = totalMinutes;
  const remainingMinutesThisWeek = Math.max(0, estMinutesThisWeek - loggedMinutesThisWeek);

  const taskById = new Map(tasks.map(task => [String(task.id), task]));
  const byCourseEst = new Map<string | null, number>();
  for (const task of weekTodos) {
    const course = task.course ?? null;
    byCourseEst.set(course, (byCourseEst.get(course) || 0) + (task.estimatedMinutes || 0));
  }
  const byCourseLogged = new Map<string | null, number>();
  for (const session of weekSessions) {
    const task = session.taskId ? taskById.get(String(session.taskId)) : undefined;
    const course = task?.course ?? null;
    byCourseLogged.set(course, (byCourseLogged.get(course) || 0) + (session.minutes || 0));
  }
  const courseKeys = new Set([...byCourseEst.keys(), ...byCourseLogged.keys()]);
  const courseBreakdown = [...courseKeys].map(course => {
    const estMinutes = byCourseEst.get(course) || 0;
    const loggedMinutes = byCourseLogged.get(course) || 0;
    return { course, estMinutes, loggedMinutes, remainingMinutes: Math.max(0, estMinutes - loggedMinutes) };
  }).sort((a, b) => b.remainingMinutes - a.remainingMinutes);

  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const dailyEst: Array<{ date: string; estMinutes: number }> = [];
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 7; i++) {
    const date = new Date(start); date.setDate(date.getDate() + i);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    const estMinutes = tasks
      .filter(task => task.status !== 'done')
      .filter(task => { const due = new Date(task.dueDate); return due >= date && due <= end; })
      .reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);
    dailyEst.push({ date: key(date), estMinutes });
  }
  const maxDayMinutes = dailyEst.reduce((max, item) => Math.max(max, item.estMinutes), 0);
  const heavyDays = dailyEst.filter(item => item.estMinutes >= 240).length;

  const past7Start = new Date(now.getTime() - 7 * 864e5);
  const past7Sessions = sessions.filter(session => {
    const when = new Date(session.when);
    return when >= past7Start && when <= now;
  });
  const past7Minutes = past7Sessions.reduce((sum, session) => sum + (session.minutes || 0), 0);
  const avgHours7d = past7Minutes > 0 ? Math.round((past7Minutes / 60 / 7) * 10) / 10 : null;
  const past7Focus = past7Sessions.map(session => session.focus).filter((value): value is number => typeof value === 'number');
  const avgFocus7d = past7Focus.length ? Math.round((past7Focus.reduce((a, b) => a + b, 0) / past7Focus.length) * 10) / 10 : null;

  const subjectMap = new Map<string, { totalMinutes: number; totalFocus: number; focusCount: number; count: number }>();
  for (const task of tasks.filter(item => item.status === 'done' && Number(item.actualMinutes) > 0)) {
    const subject = task.course || 'Unassigned';
    const current = subjectMap.get(subject) || { totalMinutes: 0, totalFocus: 0, focusCount: 0, count: 0 };
    current.totalMinutes += Number(task.actualMinutes) || 0;
    current.count += 1;
    if (typeof task.focus === 'number') { current.totalFocus += task.focus; current.focusCount += 1; }
    subjectMap.set(subject, current);
  }
  const subjectAverages = Array.from(subjectMap.entries()).map(([subject, value]) => ({
    subject,
    avgMinutesPerTask: Math.round(value.totalMinutes / value.count),
    avgFocus: value.focusCount ? Math.round((value.totalFocus / value.focusCount) * 10) / 10 : 0,
    totalTasks: value.count,
  })).filter(item => item.totalTasks >= 2).sort((a, b) => b.totalTasks - a.totalTasks);

  return {
    upcoming7d,
    hoursThisWeek,
    avgFocusThisWeek,
    estMinutesThisWeek,
    loggedMinutesThisWeek,
    remainingMinutesThisWeek,
    courseBreakdown,
    dailyEst,
    heavyDays,
    maxDayMinutes,
    avgHours7d,
    avgFocus7d,
    subjectAverages,
  };
}
