import type { Task } from './types';
import type {
  ClassCapture,
  CourseQuestion,
  OutlineProposal,
  StoredSyllabusAnalysis,
  StoredSyllabusItem,
  SyllabusChangeSummary,
} from './courseWorkspace';

export interface AssignmentMilestone {
  title: string;
  dueDate: string;
  activity: string;
  estimatedMinutes: number;
  tag: string;
}

export function assignmentMilestones(title: string, dueDate: string, typeHint?: string): AssignmentMilestone[] {
  const finalDate = new Date(dueDate);
  const normalized = `${title} ${typeHint || ''}`.toLowerCase();
  const isPresentation = /presentation|oral argument/.test(normalized);
  const isResearch = /memo|brief|paper|essay|project/.test(normalized);
  const offsets = isPresentation
    ? [
        ['Review instructions and rubric', 21, 30, 'instructions'],
        ['Research and gather authorities', 14, 180, 'research'],
        ['Build presentation outline', 9, 120, 'outline'],
        ['Create slides or speaking notes', 6, 150, 'draft'],
        ['Practice full presentation', 3, 90, 'practice'],
        ['Final review and submit', 0, 45, 'submit'],
      ]
    : isResearch
      ? [
          ['Review instructions and rubric', 21, 30, 'instructions'],
          ['Research authorities and organize sources', 14, 240, 'research'],
          ['Complete first draft', 8, 240, 'draft'],
          ['Revise analysis and organization', 4, 180, 'revision'],
          ['Citation and formatting check', 2, 90, 'citations'],
          ['Final proof and submit', 0, 45, 'submit'],
        ]
      : [
          ['Review instructions', 7, 20, 'instructions'],
          ['Complete working draft', 3, 90, 'draft'],
          ['Review and submit', 0, 30, 'submit'],
        ];

  return offsets.map(([label, daysBefore, minutes, tag]) => {
    const due = new Date(finalDate);
    due.setDate(due.getDate() - Number(daysBefore));
    due.setHours(20, 0, 0, 0);
    return {
      title: `${label}: ${title}`,
      dueDate: due.toISOString(),
      activity: tag === 'practice' ? 'practice' : tag === 'outline' ? 'outline' : 'other',
      estimatedMinutes: Number(minutes),
      tag: String(tag),
    };
  });
}

function mondayKey(value = new Date()) {
  const date = new Date(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(12, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function buildOutlineProposal(
  courseTitle: string,
  captures: ClassCapture[],
  questions: CourseQuestion[],
  completedTasks: Task[],
  syllabus?: StoredSyllabusAnalysis,
  now = new Date(),
): OutlineProposal | null {
  const weekStart = mondayKey(now);
  const recentCaptures = captures.filter(capture => capture.classDate >= weekStart);
  const openQuestions = questions.filter(question => question.status === 'open');
  const recentTasks = completedTasks.filter(task => {
    const completed = task.completedAt ? new Date(task.completedAt) : null;
    return completed && completed.toISOString().slice(0, 10) >= weekStart;
  });
  const syllabusTopics = (syllabus?.sessionSummary || [])
    .filter(session => session.date >= weekStart && session.date <= new Date(now.getTime() + 6 * 86400000).toISOString().slice(0, 10))
    .map(session => session.topic)
    .filter(Boolean) as string[];

  if (!recentCaptures.length && !openQuestions.length && !recentTasks.length && !syllabusTopics.length) return null;

  const sections: string[] = [];
  if (syllabusTopics.length) sections.push(`Topics covered\n${syllabusTopics.map(topic => `- ${topic}`).join('\n')}`);
  if (recentCaptures.some(capture => capture.topic)) sections.push(`Rules and doctrines\n${recentCaptures.filter(capture => capture.topic).map(capture => `- ${capture.topic}`).join('\n')}`);
  if (recentCaptures.some(capture => capture.cases)) sections.push(`Cases and analogies\n${recentCaptures.filter(capture => capture.cases).map(capture => `- ${capture.cases}`).join('\n')}`);
  if (recentCaptures.some(capture => capture.professorEmphasis)) sections.push(`Professor emphasis\n${recentCaptures.filter(capture => capture.professorEmphasis).map(capture => `- ${capture.professorEmphasis}`).join('\n')}`);
  if (recentTasks.length) sections.push(`Completed source work\n${recentTasks.slice(0, 8).map(task => `- ${task.title}`).join('\n')}`);
  if (openQuestions.length) sections.push(`Questions to resolve before finalizing\n${openQuestions.slice(0, 8).map(question => `- ${question.text}`).join('\n')}`);

  return {
    id: `outline:${courseTitle}:${weekStart}:${Date.now()}`,
    weekStart,
    createdAt: new Date().toISOString(),
    title: `${courseTitle} weekly outline update for ${weekStart}`,
    content: sections.join('\n\n'),
    sourceCaptureIds: recentCaptures.map(capture => capture.id),
    sourceQuestionIds: openQuestions.map(question => question.id),
    status: 'draft',
  };
}

function itemIdentity(item: StoredSyllabusItem) {
  return item.sourceKey || `${item.kind}|${item.title.toLowerCase()}`;
}

export function compareSyllabusVersions(previous: StoredSyllabusAnalysis | undefined, current: StoredSyllabusAnalysis): SyllabusChangeSummary {
  const before = new Map((previous?.importItems || []).map(item => [itemIdentity(item), item]));
  const after = new Map((current.importItems || []).map(item => [itemIdentity(item), item]));
  const added: StoredSyllabusItem[] = [];
  const removed: StoredSyllabusItem[] = [];
  const changed: Array<{ before: StoredSyllabusItem; after: StoredSyllabusItem }> = [];
  let unchanged = 0;

  for (const [key, item] of after) {
    const old = before.get(key);
    if (!old) added.push(item);
    else if (old.title !== item.title || old.dueDate !== item.dueDate || old.selected !== item.selected || old.notes !== item.notes) changed.push({ before: old, after: item });
    else unchanged++;
  }
  for (const [key, item] of before) if (!after.has(key)) removed.push(item);

  return {
    comparedAt: new Date().toISOString(),
    previousVersionId: previous?.id,
    currentVersionId: current.id,
    added,
    removed,
    changed,
    unchanged,
  };
}

export function examPlanTasks(courseTitle: string, examDate: string, weakAreas: string[] = []) {
  const exam = new Date(`${examDate}T20:00:00`);
  const steps = [
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
  const tasks = steps.map(step => {
    const due = new Date(exam);
    due.setDate(due.getDate() - step.daysBefore);
    return { ...step, dueDate: due.toISOString() };
  });
  for (const area of weakAreas.slice(0, 5)) {
    const due = new Date(exam);
    due.setDate(due.getDate() - 5);
    tasks.push({ daysBefore: 5, title: `Drill weak issue: ${area}`, activity: 'review', minutes: 60, dueDate: due.toISOString() });
  }
  return tasks;
}

export function recoveryReason(task: Task, examDays?: number | null) {
  const title = `${task.title} ${(task.tags || []).join(' ')}`.toLowerCase();
  const dueDays = Math.ceil((new Date(task.dueDate).getTime() - Date.now()) / 86400000);
  if (/optional|recommended only|extra credit/.test(title)) return 'Optional work with lower immediate value.';
  if (examDays !== null && examDays !== undefined && examDays <= 14 && /outline|practice|review/.test(title)) return `Direct exam preparation with ${examDays} days remaining.`;
  if (dueDays < 0) return `${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? '' : 's'} overdue.`;
  if (dueDays <= 1) return 'Due within one day.';
  if (/memo|brief|paper|exam|presentation|project/.test(title)) return 'Major graded deliverable.';
  if (/read|pages|chapter|casebook/.test(title)) return 'Reading can be reduced to rules, holdings, and professor emphasis if time is limited.';
  return 'Lower urgency than current deadlines.';
}
