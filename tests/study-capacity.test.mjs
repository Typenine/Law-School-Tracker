import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';
const tsSource = readFileSync(new URL('../lib/studyCapacity.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(tsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { summarizeStudyDays, addPlannedStudyMinutes, dailyStudyCapacity, conflictsForDay, remainingEstimates, chicagoStudyDay } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const date = when => when.slice(0, 10);
const block = (minutes, taskId='law-task', day='2026-10-21') => ({ id:'block1', day, taskId, plannedMinutes:minutes });
const session = (minutes, taskId='law-task', when='2026-10-21T18:00:00Z') => ({ id:'session1', taskId, when, minutes });
const d = (blocks,sessions,remaining={}) => summarizeStudyDays(blocks,sessions,date,remaining)['2026-10-21'];

describe('actual + unfinished time never double counts', () => {
  it('reuses its Chicago formatter without breaking daylight-boundary dates', () => {
    assert.equal((tsSource.match(/new Intl\\.DateTimeFormat/g) || []).length, 1);
    assert.equal(chicagoStudyDay('2026-10-25T04:59:00Z'), '2026-10-24');
    assert.equal(chicagoStudyDay('2026-10-25T05:01:00Z'), '2026-10-25');
  });
  it('reserves planned time before work starts',()=>{
    assert.deepEqual([d([block(100)],[]).loggedMinutes,d([block(100)],[]).remainingPlannedMinutes], [0,100]);
  });
  it('does not restore hours when a finished task disappears from the plan',()=>{
    const load=d([],[session(100)],{'law-task':0});
    assert.equal(load.committedMinutes,100);
    assert.equal(180-load.committedMinutes,80);
  });
  it('handles original unreconciled block after 40 minutes partial progress',()=>{
    const load=d([block(100)],[session(40)],{'law-task':60});
    assert.deepEqual([load.loggedMinutes,load.remainingPlannedMinutes,load.committedMinutes],[40,60,100]);
  });
  it('handles already-reduced block after 40 minutes partial progress',()=>{
    const load=d([block(60)],[session(40)],{'law-task':60});
    assert.deepEqual([load.loggedMinutes,load.remainingPlannedMinutes,load.committedMinutes],[40,60,100]);
  });
  it('does not subtract unrelated study from pending task allocations',()=>{
    const load=d([block(60)],[session(40,null)],{'law-task':60});
    assert.deepEqual([load.loggedMinutes,load.remainingPlannedMinutes,load.committedMinutes],[40,60,100]);
  });
  it('does not count the same logged time twice when the original plan has not been reconciled',()=>{
    const load=d([block(100)],[session(40)]);
    assert.deepEqual([load.loggedMinutes,load.remainingPlannedMinutes,load.committedMinutes],[40,60,100]);
  });
  it('accounts for overruns',()=>{
    const load=d([block(100)],[session(125)],{'law-task':0});
    assert.equal(load.committedMinutes,125);
  });
  it('splits previously logged work from a future scheduled day',()=>{
    const days=summarizeStudyDays([block(60,'law-task','2026-10-21'),block(40,'law-task','2026-10-22')],[session(40)],date,{'law-task':60});
    assert.equal(days['2026-10-21'].committedMinutes,60);
    assert.equal(days['2026-10-22'].remainingPlannedMinutes,40);
  });
  it('keeps separate days independent',()=>{
    const days=summarizeStudyDays([],[session(40),{...session(60),id:'other',when:'2026-10-22T18:00:00Z'}],date);
    assert.equal(days['2026-10-21'].committedMinutes,40);
    assert.equal(days['2026-10-22'].committedMinutes,60);
  });
  it('projects newly planned work without mutating prior load',()=>{
    const prior=d([],[session(40)],{'law-task':60});
    const next=addPlannedStudyMinutes(prior,'law-task',60,{'law-task':60});
    assert.equal(next.committedMinutes,100);
    assert.equal(prior.committedMinutes,40);
  });
  it('returns zero availability for an explicitly unavailable day',()=>{
    assert.equal(dailyStudyCapacity(6,{6:0},{},{},[]),0);
  });
  it('does not double subtract overlapping class and break times',()=>{
    const capacity=dailyStudyCapacity(3,{3:240},{3:[{start:'9:00 AM',end:'12:00 PM'}]},
      {3:[{start:'10:00 AM',end:'11:00 AM'}]},[[10*60+30,11*60+30]]);
    assert.equal(capacity,90);
  });
  it('subtracts class time inside a configured study window',()=>{
    const courses=[{startDate:'2026-08-25',endDate:'2026-12-01',meetingDays:[3],meetingStart:'10:30',meetingEnd:'11:45'}];
    const busy=conflictsForDay('2026-10-21',courses,[]);
    assert.deepEqual(busy,[[630,705]]);
  });
  it('uses the task remaining estimates as the source of unfinished work',()=>{
    assert.deepEqual(remainingEstimates([{id:'a',status:'todo',estimatedMinutes:60},{id:'b',status:'done',estimatedMinutes:30}]),{a:60,b:0});
  });
});
