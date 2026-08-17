
import { randomUUID } from 'crypto';
import { countPages, parsePageRanges } from './pageRanges';
import { courseReadingPace, splitRangesByCounts, taskRemainingRanges } from './reading';
import { getSettings, listCourses, listScheduleBlocks, listTasks, replaceAllScheduleBlocks } from './storage';

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function smartSplitTaskSchedule(taskId: string) {
  const [tasks, courses, settings, blocks] = await Promise.all([
    listTasks(), listCourses(), getSettings(['availabilityTemplateV1']), listScheduleBlocks(),
  ]);
  const task = tasks.find(t => t.id === taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const remaining = taskRemainingRanges(task);
  if (!remaining) throw Object.assign(new Error('This reading has no remaining page range to split.'), { status: 400 });
  const ranges = parsePageRanges(remaining);
  const totalPages = countPages(ranges);
  if (!totalPages) throw Object.assign(new Error('This reading has no remaining pages.'), { status: 400 });
  const pace = courseReadingPace(task.course, courses);
  const availability = (settings?.availabilityTemplateV1 && typeof settings.availabilityTemplateV1 === 'object') ? settings.availabilityTemplateV1 as Record<string, number> : {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
  if (due < today) due = new Date(today);
  const other = blocks.filter(block => block.taskId !== taskId);
  const used = new Map<string, number>();
  for (const block of other) used.set(block.day, (used.get(block.day) || 0) + Math.max(0, Number(block.plannedMinutes) || 0));
  const slots: Array<{ day: string; pages: number }> = [];
  let remainingPages = totalPages;
  for (let i = 0; i < 31 && remainingPages > 0; i++) {
    const day = new Date(today); day.setDate(today.getDate() + i);
    if (day > due) break;
    const key = ymd(day);
    const configured = Number((availability as any)[day.getDay()]);
    const dailyCapacity = Number.isFinite(configured) && configured > 0 ? configured : (day.getDay() === 0 || day.getDay() === 6 ? 90 : 150);
    const free = Math.max(0, dailyCapacity - (used.get(key) || 0));
    const pageCapacity = Math.max(0, Math.floor(free / pace.mpp));
    if (pageCapacity <= 0) continue;
    const pages = Math.min(remainingPages, pageCapacity);
    slots.push({ day: key, pages });
    remainingPages -= pages;
  }
  if (!slots.length) slots.push({ day: ymd(due), pages: totalPages });
  else if (remainingPages > 0) slots[slots.length - 1].pages += remainingPages;
  const chunks = splitRangesByCounts(ranges, slots.map(slot => slot.pages));
  const plan = slots.slice(0, chunks.length).map((slot, index) => {
    const pages = countPages(parsePageRanges(chunks[index]));
    return {
      id: `reading-${randomUUID()}`,
      taskId,
      day: slot.day,
      plannedMinutes: Math.max(1, Math.round(pages * pace.mpp)),
      guessed: pace.source === 'default',
      title: `${task.title} — ${chunks[index]}`,
      course: task.course || '',
      pages,
      priority: task.priority ?? null,
      catchup: false,
      range: chunks[index],
    };
  });
  await replaceAllScheduleBlocks([...other, ...plan.map(({ range, ...block }) => block)]);
  return { taskId, paceMinutesPerPage: pace.mpp, paceSource: pace.source, plan };
}
