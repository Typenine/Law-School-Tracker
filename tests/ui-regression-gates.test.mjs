import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('critical workflows must survive UI edits', () => {
  it('the task workspace loads primary records independently of optional requests', () => {
    const source = read('components/TaskWorkspaceV2.tsx');
    assert.match(source, /await apiFetch<WorkspaceResponse>\('\/api\/tasks\/workspace'\)/);
    assert.doesNotMatch(source, /const \[workspace,\s*sessionResponse,\s*notesResponse\] = await Promise\.all/);
    assert.match(source, /setData\(workspace\)/);
  });
  it('This Week distinguishes loading and API errors from an empty backlog', () => {
    const source = read('app/week-plan/page.tsx');
    assert.match(source, /tasksLoading && !tasks\.length/);
    assert.match(source, /tasksError && !tasks\.length/);
    assert.match(source, /noTasksToPlan/);
  });
  it('one schedule persistence mechanism is used by This Week', () => {
    const source = read('app/week-plan/page.tsx');
    assert.match(source, /useSchedule\(\)/);
    assert.doesNotMatch(source, /\/\/ Debounced server save for blocks/);
    assert.doesNotMatch(source, /saveBlocksNow/);
    const hook = read('lib/useSchedule.ts');
    assert.match(hook, /saveStatus/);
    assert.match(hook, /apiFetch\('\/api\/schedule', \{ method: 'PUT'/);
  });
  it('scheduled work is reversible and calendar detail is available', () => {
    const source = read('app/week-plan/page.tsx');
    assert.match(source, /function clearThisWeek\(\)/);
    assert.match(source, /snapshot\('Clear week'\)/);
    assert.match(source, /Undo \{undoLabel/);
    assert.match(source, /Expanded day details/);
    assert.match(source, /availabilityExpanded/);
  });
  it('Today displays completed work and logged study separately', () => {
    const source = read('app/page.tsx');
    assert.match(source, /completedTodayTasks/);
    assert.match(source, /completedTodaySessions/);
    assert.match(source, /Completed today/);
  });
  it('Study Log can adjust semester and link a prior session to an assignment', () => {
    const page = read('app/log/page.tsx');
    assert.match(page, /semesterFilter !== 'all'/);
    assert.match(page, /patch\.semester = editSemester/);
    assert.match(page, /patch\.taskId = editTaskId/);
    const route = read('app/api/sessions/[id]/route.ts');
    assert.match(route, /parsed\.data\.taskId/);
    const storage = read('lib/storage.ts');
    assert.match(storage, /push\('task_id', patch\.taskId\)/);
  });
  it('standalone timer finish does not mislabel study as completed assignment', () => {
    const source = read('components/QuickStudyTimer.tsx');
    assert.match(source, /Finish study session/);
    assert.match(source, /linkedTaskId \|\| null/);
    assert.match(source, /does not complete the task/);
  });
});
