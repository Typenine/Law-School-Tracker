import { scheduleExamSteps } from './assignmentPlanning';

type ExamStep = [string, number, number, string];

export function examPlanTasks(courseTitle: string, examDate: string, weakAreas: string[] = [], now = new Date()) {
  const exam = new Date(`${examDate}T20:00:00`);
  const daysLeft = Math.ceil((exam.getTime() - now.getTime()) / 86400000);
  const full = [
    { daysBefore: 28, title: `Complete ${courseTitle} master outline`, activity: 'outline', minutes: 240 },
    { daysBefore: 21, title: `Create ${courseTitle} attack outline and issue checklist`, activity: 'outline', minutes: 180 },
    { daysBefore: 17, title: `Build ${courseTitle} rule statements and flowcharts`, activity: 'outline', minutes: 150 },
    { daysBefore: 14, title: `Complete first timed ${courseTitle} practice essay`, activity: 'practice', minutes: 120 },
    { daysBefore: 10, title: `Review ${courseTitle} case analogies and exceptions`, activity: 'review', minutes: 120 },
    { daysBefore: 7, title: `Complete second timed ${courseTitle} practice set`, activity: 'practice', minutes: 150 },
    { daysBefore: 4, title: `Patch weak areas for ${courseTitle}`, activity: 'review', minutes: 120 },
    { daysBefore: 2, title: `Finalize printed ${courseTitle} outline additions`, activity: 'outline', minutes: 90 },
    { daysBefore: 1, title: `Light review of ${courseTitle} attack sheet`, activity: 'review', minutes: 45 },
  ];
  const chosen = daysLeft >= 28 ? full : daysLeft >= 14 ? full.slice(1) : daysLeft >= 7 ? [full[1],full[3],full[4],full[6],full[7],full[8]] : [full[1],full[3],full[6],full[7],full[8]];
  const tuples: ExamStep[] = chosen.map(item => [item.title, item.daysBefore, item.minutes, item.activity]);
  const scheduled = scheduleExamSteps(exam, tuples, now);
  const tasks = scheduled.map(({ step, due }) => ({ daysBefore: step[1], title: step[0], activity: step[3], minutes: step[2], dueDate: due.toISOString() }));
  for (const area of weakAreas.slice(0, 5)) {
    const due = new Date(exam);
    due.setDate(due.getDate() - Math.min(5, Math.max(1, daysLeft - 1)));
    due.setHours(20, 0, 0, 0);
    if (due < now) due.setTime(now.getTime() + 86400000);
    tasks.push({ daysBefore: 5, title: `Drill weak issue: ${area}`, activity: 'review', minutes: 60, dueDate: due.toISOString() });
  }
  return tasks;
}
