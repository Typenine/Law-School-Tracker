export interface AssignmentMilestone {
  title: string;
  dueDate: string;
  activity: string;
  estimatedMinutes: number;
  tag: string;
}

type Step = [string, number, number, string];

function atEight(date: Date) {
  const value = new Date(date);
  value.setHours(20, 0, 0, 0);
  return value;
}

function scheduled(finalDate: Date, steps: Step[], now: Date) {
  const earliest = atEight(now);
  earliest.setDate(earliest.getDate() + 1);
  const final = atEight(finalDate);
  const availableDays = Math.max(0, Math.floor((final.getTime() - earliest.getTime()) / 86400000));
  return steps.map((step, index) => {
    const intended = atEight(final);
    intended.setDate(intended.getDate() - step[1]);
    if (intended >= earliest) return { step, due: intended };
    const ratio = steps.length <= 1 ? 1 : index / (steps.length - 1);
    const due = atEight(earliest);
    due.setDate(due.getDate() + Math.floor(availableDays * ratio));
    return { step, due: due > final ? final : due };
  });
}

export function assignmentMilestones(title: string, dueDate: string, typeHint?: string, now = new Date()): AssignmentMilestone[] {
  const normalized = `${title} ${typeHint || ''}`.toLowerCase();
  const presentation = /presentation|oral argument/.test(normalized);
  const research = /memo|brief|paper|essay|project/.test(normalized);
  const steps: Step[] = presentation
    ? [['Review instructions and rubric',21,30,'instructions'],['Research and gather authorities',14,180,'research'],['Build presentation outline',9,120,'outline'],['Create slides or speaking notes',6,150,'draft'],['Practice full presentation',3,90,'practice'],['Final review and submit',0,45,'submit']]
    : research
      ? [['Review instructions and rubric',21,30,'instructions'],['Research authorities and organize sources',14,240,'research'],['Complete first draft',8,240,'draft'],['Revise analysis and organization',4,180,'revision'],['Citation and formatting check',2,90,'citations'],['Final proof and submit',0,45,'submit']]
      : [['Review instructions',7,20,'instructions'],['Complete working draft',3,90,'draft'],['Review and submit',0,30,'submit']];

  return scheduled(new Date(dueDate), steps, now).map(({ step, due }) => ({
    title: `${step[0]}: ${title}`,
    dueDate: due.toISOString(),
    activity: step[3] === 'practice' ? 'practice' : step[3] === 'outline' ? 'outline' : 'other',
    estimatedMinutes: step[2],
    tag: step[3],
  }));
}

export function scheduleExamSteps(finalDate: Date, steps: Step[], now = new Date()) {
  return scheduled(finalDate, steps, now);
}
