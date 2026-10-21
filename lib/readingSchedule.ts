
import { randomUUID } from 'crypto';
import { countPages, parsePageRanges } from './pageRanges';
import { courseReadingPace, splitRangesByCounts, taskRemainingRanges } from './reading';
import { getSettings, listCourses, listScheduleBlocks, listTasks, listSessions, replaceAllScheduleBlocks } from './storage';
import { chicagoStudyDay, summarizeStudyDays, remainingEstimates, dailyStudyCapacity, conflictsForDay, addPlannedStudyMinutes, type StudyWindow } from './studyCapacity';

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function smartSplitTaskSchedule(taskId: string) {
  const [tasks, courses, settings, blocks, sessions] = await Promise.all([
    listTasks(), listCourses(), getSettings(['availabilityTemplateV1','availabilityWindowsV1','availabilityBreaksV1']), listScheduleBlocks(), listSessions(),
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
  const remainingByTask = remainingEstimates(tasks);
  const dayLoads = summarizeStudyDays(other, sessions, chicagoStudyDay, remainingByTask);
  const windows = (settings?.availabilityWindowsV1 || {}) as Record<string,StudyWindow[]>;
  const breaks = (settings?.availabilityBreaksV1 || {}) as Record<string,StudyWindow[]>;
  const slots: Array<{ day: string; pages: number }> = [];
  let remainingPages = totalPages;
  for (let i = 0; i < 31 && remainingPages > 0; i++) {
    const day = new Date(today); day.setDate(today.getDate() + i);
    if (day > due) break;
    const key = ymd(day);
    const dailyCapacity = dailyStudyCapacity(day.getDay(), availability, windows, breaks, conflictsForDay(key,courses,tasks));
    const free = Math.max(0, dailyCapacity - (dayLoads[key]?.committedMinutes || 0));
    const pageCapacity = Math.max(0, Math.floor(free / pace.mpp));
    if (pageCapacity <= 0) continue;
    const pages = Math.min(remainingPages, pageCapacity);
    slots.push({ day: key, pages });
    dayLoads[key] = addPlannedStudyMinutes(dayLoads[key], taskId, Math.ceil(pages * pace.mpp), remainingByTask);
    remainingPages -= pages;
  }
  if (!slots.length || remainingPages > 0) {
    throw Object.assign(new Error('Insufficient available study hours to schedule this reading before its deadline. Adjust availability or move other work.'), { status: 409 });
  }
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
