/** Shared study-time accounting for Today, Week Plan, capacity and risk. */
export type StudyDayLoad = {
  loggedMinutes: number;
  plannedMinutes: number;
  remainingPlannedMinutes: number;
  committedMinutes: number;
  plannedByTask: Record<string, number>;
  loggedByTask: Record<string, number>;
  overlapByTask: Record<string, number>;
};
export type StudyBlock = { day: string; taskId?: string | null; id?: string | null; plannedMinutes: number };
export type StudySessionRow = { when: string; taskId?: string | null; id?: string | null; minutes: number };
export type RemainingByTask = Record<string, number>;
export type StudyWindow = { start?: string | null; end?: string | null };
type Interval = [number, number];
const validDay = /^\d{4}-\d{2}-\d{2}$/;
const positive = (number: unknown): number => { const n = Number(number); return Number.isFinite(n) ? Math.max(0,n) : 0; };
const blank = (): StudyDayLoad => ({ loggedMinutes:0, plannedMinutes:0, remainingPlannedMinutes:0, committedMinutes:0, plannedByTask:{}, loggedByTask:{}, overlapByTask:{} });
const keyOf = (taskId?: string | null): string | null => taskId ? 'task:' + taskId : null;
export function chicagoStudyDay(when: string | Date): string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(when));
}
export function remainingEstimates(tasks: readonly { id: string; status: string; estimatedMinutes?: number | null }[]): RemainingByTask {
  const result: RemainingByTask = {};
  for (const task of tasks) result[task.id] = task.status === 'done' ? 0 : positive(task.estimatedMinutes);
  return result;
}

/**
 * When a block has been reduced to the unfinished portion after a partial log,
 * logged and planned time are ADDITIVE. If it is still the original allocation,
 * only the unspent part of that block is additive. We detect that difference
 * using the task's remaining estimate, not max(planned, logged).
 */
export function summarizeStudyDays(
  blocks: readonly StudyBlock[], sessions: readonly StudySessionRow[],
  sessionDay: (when: string) => string = chicagoStudyDay,
  remainingByTask: RemainingByTask = {},
): Record<string, StudyDayLoad> {
  const days: Record<string,StudyDayLoad> = {};
  const totalScheduled: Record<string,number> = {};
  for(const [index,block] of blocks.entries()){
    if(!validDay.test(block.day))continue;
    const day=days[block.day] ||= blank();
    const task=keyOf(block.taskId), key=task || 'block:'+(block.id||index), minutes=positive(block.plannedMinutes);
    day.plannedMinutes+=minutes;
    day.plannedByTask[key]=(day.plannedByTask[key]||0)+minutes;
    if(task)totalScheduled[task]=(totalScheduled[task]||0)+minutes;
  }
  for(const [index,session] of sessions.entries()){
    if(!Number.isFinite(Date.parse(session.when)))continue;
    let date: string;try{date=sessionDay(session.when);}catch{continue;}
    if(!validDay.test(date))continue;
    const day=days[date] ||= blank();
    const key=keyOf(session.taskId)||'session:'+(session.id||index), minutes=positive(session.minutes);
    day.loggedMinutes+=minutes;
    day.loggedByTask[key]=(day.loggedByTask[key]||0)+minutes;
  }
  const overlapsLeft: Record<string,number>={};
  for(const [key,planned] of Object.entries(totalScheduled)){
    const remaining=remainingByTask[key.slice(5)];
    overlapsLeft[key]=Number.isFinite(remaining)?Math.max(0,planned-positive(remaining)):Infinity;
  }
  for(const date of Object.keys(days).sort()){
    const day=days[date];
    let overlap=0;
    for(const [key,planned] of Object.entries(day.plannedByTask)){
      const logged=day.loggedByTask[key]||0;
      const used=Math.min(planned,logged,overlapsLeft[key]??Infinity);
      if(Number.isFinite(overlapsLeft[key]))overlapsLeft[key]-=used;
      day.overlapByTask[key]=used;overlap+=used;
    }
    day.remainingPlannedMinutes=Math.max(0,day.plannedMinutes-overlap);
    day.committedMinutes=day.loggedMinutes+day.remainingPlannedMinutes;
  }
  return days;
}
export function addPlannedStudyMinutes(day: StudyDayLoad | undefined, taskId: string | null | undefined, minutes: number, remainingByTask: RemainingByTask = {}): StudyDayLoad {
  const next: StudyDayLoad=day?{...day,plannedByTask:{...day.plannedByTask},loggedByTask:{...day.loggedByTask},overlapByTask:{...day.overlapByTask}}:blank();
  const key=keyOf(taskId)||'block:unlinked';
  next.plannedMinutes+=positive(minutes);next.plannedByTask[key]=(next.plannedByTask[key]||0)+positive(minutes);
  let overlap=0;
  for(const [k,planned] of Object.entries(next.plannedByTask)){
    const logged=next.loggedByTask[k]||0;
    const remaining=remainingByTask[k.slice(5)];
    const prior=next.overlapByTask[k]||0;
    const used=Number.isFinite(remaining)
      ? Math.min(planned,logged,Math.max(prior,planned-positive(remaining)))
      : Math.min(planned,logged);
    next.overlapByTask[k]=used;overlap+=used;
  }
  next.remainingPlannedMinutes=Math.max(0,next.plannedMinutes-overlap);
  next.committedMinutes=next.loggedMinutes+next.remainingPlannedMinutes;
  return next;
}

export function timeOfDay(value: string | null | undefined): number | null {
  const m=/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec((value||'').trim());
  if(!m)return null;
  let h=Number(m[1]);const min=Number(m[2]||0);
  if(h>23||min>59||(m[3]&&(h<1||h>12)))return null;
  if(m[3])h=h%12+(m[3].toLowerCase()==='pm'?12:0);
  return h*60+min;
}
const intervals=(windows: readonly StudyWindow[]):Interval[]=>windows.flatMap(w=>{
  const a=timeOfDay(w.start),b=timeOfDay(w.end);
  return a!==null&&b!==null&&b>a?[[a,b] as Interval]:[];
});
function merge(ranges: readonly Interval[]):Interval[]{
  const result:Interval[]=[];
  for(const [a,b] of [...ranges].sort((x,y)=>x[0]-y[0])){
    const last=result[result.length-1];
    if(last&&a<=last[1])last[1]=Math.max(last[1],b);
    else result.push([a,b]);
  }
  return result;
}
export function dailyStudyCapacity(
  dow:number, availability:Record<number,number>,
  windowsByDow:Record<number,StudyWindow[]>,
  breaksByDow:Record<number,StudyWindow[]>,events:readonly Interval[]=[],
):number{
  const wins=merge(intervals(windowsByDow[dow]||[]));
  const unavailable=merge([...intervals(breaksByDow[dow]||[]),...events.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a)]);
  if(!wins.length){
    const raw=Number(availability[dow]);
    const occupied=unavailable.reduce((sum,[a,b])=>sum+Math.max(0,b-a),0);
    return Math.max(0,(Number.isFinite(raw)?raw:0)-occupied);
  }
  let total=0;
  for(const [ws,we] of wins){
    total+=we-ws;
    for(const [bs,be] of unavailable) total-=Math.max(0,Math.min(we,be)-Math.max(ws,bs));
  }
  return Math.max(0,total);
}
export type ConflictCourse={
  startDate?:string|null;endDate?:string|null;
  meetingBlocks?:Array<{days:number[];start:string;end:string}>|null;
  meetingDays?:number[]|null;meetingStart?:string|null;meetingEnd?:string|null;
};
export type ConflictTask={dueDate:string;startTime?:string|null;endTime?:string|null};
export function conflictsForDay(day:string,courses:readonly ConflictCourse[],tasks:readonly ConflictTask[]):Interval[]{
  const [y,m,d]=day.split('-').map(Number);
  const dow=new Date(y,m-1,d,12).getDay();
  const out:Interval[]=[];
  for(const c of courses){
    if(c.startDate&&c.startDate.slice(0,10)>day)continue;
    if(c.endDate&&c.endDate.slice(0,10)<day)continue;
    const blocks=c.meetingBlocks?.length?c.meetingBlocks:[{days:c.meetingDays||[],start:c.meetingStart||'',end:c.meetingEnd||''}];
    for(const b of blocks){
      if(!b.days.includes(dow))continue;
      const a=timeOfDay(b.start),z=timeOfDay(b.end);
      if(a!==null&&z!==null&&z>a)out.push([a,z]);
    }
  }
  for(const t of tasks){
    if(chicagoStudyDay(t.dueDate)!==day)continue;
    const a=timeOfDay(t.startTime),b=timeOfDay(t.endTime);
    if(a!==null&&b!==null&&b>a)out.push([a,b]);
  }
  return out;
}
