import type { Task } from './types';
import type { ClassCapture, CourseQuestion, OutlineProposal, StoredSyllabusAnalysis } from './courseWorkspace';

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
  weekStartOverride?: string,
): OutlineProposal | null {
  const weekStart = weekStartOverride || mondayKey(now);
  const weekEndDate = new Date(`${weekStart}T12:00:00`);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);
  const recentCaptures = captures.filter(item => item.classDate >= weekStart && item.classDate <= weekEnd);
  const recentQuestions = questions.filter(item => item.status === 'open' && item.createdAt.slice(0, 10) >= weekStart && item.createdAt.slice(0, 10) <= weekEnd);
  const recentTasks = completedTasks.filter(item => item.completedAt && item.completedAt.slice(0, 10) >= weekStart && item.completedAt.slice(0, 10) <= weekEnd);
  const syllabusTopics = (syllabus?.sessionSummary || []).filter(item => item.date >= weekStart && item.date <= weekEnd).map(item => item.topic).filter(Boolean) as string[];
  if (!recentCaptures.length && !recentQuestions.length && !recentTasks.length && !syllabusTopics.length) return null;

  const sections: string[] = [];
  if (syllabusTopics.length) sections.push(`Topics covered\n${syllabusTopics.map(item => `- ${item}`).join('\n')}`);
  if (recentCaptures.some(item => item.topic)) sections.push(`Rules and doctrines\n${recentCaptures.filter(item => item.topic).map(item => `- ${item.topic}`).join('\n')}`);
  if (recentCaptures.some(item => item.cases)) sections.push(`Cases and analogies\n${recentCaptures.filter(item => item.cases).map(item => `- ${item.cases}`).join('\n')}`);
  if (recentCaptures.some(item => item.professorEmphasis)) sections.push(`Professor emphasis\n${recentCaptures.filter(item => item.professorEmphasis).map(item => `- ${item.professorEmphasis}`).join('\n')}`);
  if (recentTasks.length) sections.push(`Completed source work\n${recentTasks.slice(0, 8).map(item => `- ${item.title}`).join('\n')}`);
  if (recentQuestions.length) sections.push(`Questions to resolve before finalizing\n${recentQuestions.slice(0, 8).map(item => `- ${item.text}`).join('\n')}`);

  return {
    id: `outline:${courseTitle}:${weekStart}:${Date.now()}`,
    weekStart,
    createdAt: new Date().toISOString(),
    title: `${courseTitle} weekly outline update for ${weekStart}`,
    content: sections.join('\n\n'),
    sourceCaptureIds: recentCaptures.map(item => item.id),
    sourceQuestionIds: recentQuestions.map(item => item.id),
    status: 'draft',
  };
}
