import { buildOutlineProposal } from './outlineWorkflow';
import { addOutlineDraftNotification, addWeeklyReviewNotification, generateTaskNotifications } from './notificationStore';
import { readCourseWorkspace, writeCourseWorkspace } from './courseWorkspaceStore';
import { getOrInitializeSemesters } from './semesterStore';
import { getSettings, listCourses, listTasks } from './storage';
import { isActiveTask, taskMatchesCourse } from './taskMetadata';

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    hour: Number(values.hour || 0),
  };
}

export function weekStartInTimeZone(now = new Date(), timeZone = 'America/New_York') {
  const local = localParts(now, timeZone);
  const date = new Date(`${local.date}T12:00:00Z`);
  const offset = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

async function createMissingOutlineDrafts(now: Date, timeZone: string) {
  const [courses, tasks, semesters] = await Promise.all([listCourses(), listTasks(), getOrInitializeSemesters()]);
  const activeSemester = semesters.find(item => item.isActive) || null;
  const weekStart = weekStartInTimeZone(now, timeZone);
  const activeCourses = courses.filter(course => !activeSemester || (course.semester === activeSemester.season && course.year === activeSemester.year));
  const created: string[] = [];

  for (const course of activeCourses) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await readCourseWorkspace(course.id);
      if ((current.workspace.outlineProposals || []).some(proposal => proposal.weekStart === weekStart)) break;
      const completed = tasks.filter(task =>
        isActiveTask(task) &&
        task.status === 'done' &&
        taskMatchesCourse(task, course) &&
        Boolean(task.completedAt),
      );
      const proposal = buildOutlineProposal(
        course.title,
        current.workspace.classCaptures || [],
        current.workspace.questions || [],
        completed,
        current.workspace.syllabusAnalysis,
        now,
        weekStart,
      );
      if (!proposal) break;
      const result = await writeCourseWorkspace(course.id, {
        ...current.workspace,
        outlineProposals: [...(current.workspace.outlineProposals || []), proposal],
      }, current.revision);
      if (result.conflict) continue;
      created.push(course.id);
      await addOutlineDraftNotification(course.id, course.title, weekStart, now.toISOString());
      break;
    }
  }
  return { created, weekStart };
}

export async function runAcademicMaintenance(now = new Date()) {
  const settings = await getSettings(['academicTimezone']);
  const timeZone = typeof settings.academicTimezone === 'string' && settings.academicTimezone ? settings.academicTimezone : 'America/New_York';
  const local = localParts(now, timeZone);
  const reminders = await generateTaskNotifications(now);
  const outlines = await createMissingOutlineDrafts(now, timeZone);
  let weeklyReviewCreated = false;
  if (local.weekday === 'Sun' && local.hour >= 17) {
    await addWeeklyReviewNotification(outlines.weekStart, now.toISOString());
    weeklyReviewCreated = true;
  }
  return {
    timeZone,
    localDate: local.date,
    remindersGenerated: reminders.length,
    outlineDraftsCreated: outlines.created.length,
    weeklyReviewCreated,
  };
}
