import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';
const tsSource = readFileSync(new URL('../lib/studyCapacity.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(tsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { summarizeStudyDays, addPlannedStudyMinutes } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const date = when => when.slice(0, 10);
const planned = (minutes, taskId='task1') => ({ id: 'b1', day: '2026-10-21', taskId, plannedMinutes: minutes });
const session = (minutes, taskId='task1', when='2026-10-21T18:00:00Z') => ({ id: 's1', when, taskId, minutes });
describe('weekly planner remaining capacity', () => {
  it('reserves planned time before a task is finished', () => {
    const d = summarizeStudyDays([planned(100)], [], date)['2026-10-21'];
    assert.deepEqual([d.plannedMinutes,d.loggedMinutes,d.committedMinutes], [100,0,100]);
    assert.equal(180-d.committedMinutes,80);
  });
  it('keeps used time after finishing removes the plan', () => {
    const d = summarizeStudyDays([], [session(100)], date)['2026-10-21'];
    assert.deepEqual([d.plannedMinutes,d.loggedMinutes,d.committedMinutes], [0,100,100]);
    assert.equal(180-d.committedMinutes,80);
  });
  it('does not double count partially logged time against an existing planned block', () => {
    const d = summarizeStudyDays([planned(100)], [session(40)], date)['2026-10-21'];
    assert.deepEqual([d.plannedMinutes,d.loggedMinutes,d.committedMinutes], [100,40,100]);
  });
  it('counts time logged beyond the planned duration', () => {
    const d = summarizeStudyDays([planned(100)], [session(125)], date)['2026-10-21'];
    assert.equal(d.committedMinutes,125);
  });
  it('counts separate unscheduled sessions and the correct day', () => {
    const d = summarizeStudyDays([planned(100)], [session(30,null), {...session(60),id:'s2',when:'2026-10-22T18:00:00Z'}], date);
    assert.equal(d['2026-10-21'].committedMinutes,130);
    assert.equal(d['2026-10-22'].committedMinutes,60);
  });
  it('only increases capacity use beyond existing logged time when adding a plan', () => {
    const load = summarizeStudyDays([], [session(40)], date)['2026-10-21'];
    const newPlan = addPlannedStudyMinutes(load,'task1',60);
    assert.equal(newPlan.committedMinutes,60);
    assert.equal(addPlannedStudyMinutes(newPlan,'task1',20).committedMinutes,80);
    assert.equal(load.committedMinutes,40);
  });
  it('combines two blocks for the same task on one day', () => {
    const d = summarizeStudyDays([planned(50),{...planned(50),id:'b2'}],[session(70)],date)['2026-10-21'];
    assert.equal(d.committedMinutes,100);
  });
});
