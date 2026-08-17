import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => {
  app = await startApp();
  await app.api('GET', '/api/tasks/workspace');
});
after(async () => { await app?.stop(); });
beforeEach(async () => {
  await app.reset();
  await app.db.query('TRUNCATE TABLE task_v2_meta, schedule_blocks, sessions, tasks CASCADE').catch(error => {
    if (error?.code !== '42P01') throw error;
  });
});

async function makeCourse(title = 'Evidence', code = 'LAW 7191') {
  return (await app.api('POST', '/api/courses', { title, code, semester: 'Fall', year: 2026, overrideEnabled: true, overrideMpp: 2 })).body.course;
}

async function makeReading(range = '100-150', dueDays = 3) {
  const course = await makeCourse(`Evidence ${Math.random().toString(36).slice(2, 7)}`, `LAW ${Math.floor(Math.random() * 9000) + 1000}`);
  const task = (await app.api('POST', '/api/tasks', {
    title: `Read pp. ${range}`,
    courseId: course.id,
    course: course.title,
    dueDate: new Date(Date.now() + dueDays * 864e5).toISOString(),
    activity: 'reading',
    originalPageRanges: range,
    estimatedMinutes: 102,
  })).body.task;
  return { task, course };
}

async function makeAssignment(title = 'Draft outline', estimate = 90, dueDays = 3) {
  const course = await makeCourse(`Course ${Math.random().toString(36).slice(2, 7)}`, `LAW ${Math.floor(Math.random() * 9000) + 1000}`);
  const task = (await app.api('POST', '/api/tasks', {
    title,
    courseId: course.id,
    course: course.title,
    dueDate: new Date(Date.now() + dueDays * 864e5).toISOString(),
    activity: 'assignment',
    estimatedMinutes: estimate,
  })).body.task;
  return { task, course };
}

describe('task system v2.1', () => {
  it('moves a task to Trash without changing its id, sessions, note links, or restorable schedule', async () => {
    const { task } = await makeReading();
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 20, focus: 7, pagesCompleted: '100-109' });
    await app.api('PUT', '/api/schedule', { blocks: [{ id: 'trash-block', taskId: task.id, day: new Date().toISOString().slice(0, 10), plannedMinutes: 45, title: task.title, course: task.course }] });
    const notebook = (await app.api('POST', '/api/notes/notebooks', { name: task.course, course: task.course, semester: 'Fall 2026' })).body.notebook;
    await app.api('POST', '/api/notes', { notebookId: notebook.id, title: 'Reading notes', content: 'Rule 403', sourceType: 'reading-notes', taskId: task.id });

    assert.equal((await app.api('DELETE', `/api/tasks/${task.id}`)).status, 204);
    assert.equal((await app.api('GET', '/api/tasks')).body.tasks.some(t => t.id === task.id), false);
    const workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.trash.some(t => t.id === task.id), true);
    assert.equal((await app.api('GET', '/api/sessions')).body.sessions.some(s => s.taskId === task.id), true);
    assert.equal((await app.api('GET', '/api/notes/by-task')).body.counts[task.id], 1);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === task.id), false);

    assert.equal((await app.api('POST', `/api/tasks/${task.id}/restore`, {})).status, 200);
    assert.equal((await app.api('GET', '/api/tasks')).body.tasks.some(t => t.id === task.id), true);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === task.id), true);
  });

  it('permanently deletes a trashed task only through the purge route', async () => {
    const { task } = await makeAssignment();
    await app.api('POST', '/api/sessions', { taskId: task.id, minutes: 15, focus: 6, activity: 'assignment' });
    await app.api('DELETE', `/api/tasks/${task.id}`);
    assert.equal((await app.api('DELETE', `/api/tasks/${task.id}/purge`)).status, 204);
    const all = await app.db.query('SELECT id FROM tasks WHERE id=$1', [task.id]);
    assert.equal(all.rowCount, 0);
    const sessions = (await app.api('GET', '/api/sessions')).body.sessions;
    assert.equal(sessions.some(s => s.taskId === task.id), false);
  });

  it('uses the completion snapshot to reopen the exact pre-completion reading state and schedule', async () => {
    const { task } = await makeReading();
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 30, focus: 7, pagesCompleted: '100-119' });
    await app.api('POST', `/api/tasks/${task.id}/smart-split`, {});
    const before = (await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id);
    assert.ok(before.length > 0);
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'finish', minutes: 60, focus: 8 });
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === task.id), false);

    const reopened = await app.api('POST', `/api/tasks/${task.id}/reopen`, {});
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.task.status, 'todo');
    assert.equal(reopened.body.task.remainingPageRanges, '120–150');
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id).length, before.length);
  });

  it('edits structured reading ranges without losing already-completed pages and makes courseId authoritative', async () => {
    const { task } = await makeReading();
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 25, focus: 7, pagesCompleted: '100-119' });
    const other = await makeCourse(`International Law ${Math.random().toString(36).slice(2, 7)}`, `INTL ${Math.floor(Math.random() * 9000) + 1000}`);
    const res = await app.api('PATCH', `/api/tasks/${task.id}`, { courseId: other.id, originalPageRanges: '100-175' });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.courseId, other.id);
    assert.equal(res.body.task.course, other.title);
    assert.equal(res.body.task.originalPageRanges, '100–175');
    assert.equal(res.body.task.remainingPageRanges, '120–175');
    assert.equal(res.body.task.pagesRead, 76);
  });

  it('moves from not started to in progress and tracks checklist progress for non-reading work', async () => {
    const { task } = await makeAssignment();
    let workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.tasks.find(t => t.id === task.id).displayState, 'not-started');
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 20, focus: 7 });
    const items = [
      { id: 'one', title: 'Research', done: true, createdAt: new Date().toISOString() },
      { id: 'two', title: 'Draft', done: false, createdAt: new Date().toISOString() },
    ];
    await app.api('PUT', `/api/tasks/${task.id}/checklist`, { items });
    workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    const found = workspace.tasks.find(t => t.id === task.id);
    assert.equal(found.displayState, 'in-progress');
    assert.equal(found.checklistPercent, 50);
    assert.equal(found.percentComplete, 50);
  });

  it('blocks dependent work, prevents planner exposure, rejects cycles, and restores its plan when unblocked', async () => {
    const first = await makeAssignment('Finish reading', 30);
    const second = await makeAssignment('Draft outline', 60);
    await app.api('PUT', '/api/schedule', { blocks: [{ id: 'dep-block', taskId: second.task.id, day: new Date().toISOString().slice(0, 10), plannedMinutes: 60, title: second.task.title, course: second.task.course }] });
    assert.equal((await app.api('PATCH', `/api/tasks/${second.task.id}`, { dependsOn: [first.task.id] })).status, 200);
    let workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.tasks.find(t => t.id === second.task.id).displayState, 'blocked');
    assert.equal((await app.api('GET', '/api/tasks')).body.tasks.some(t => t.id === second.task.id), false);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === second.task.id), false);

    const cycle = await app.api('PATCH', `/api/tasks/${first.task.id}`, { dependsOn: [second.task.id] });
    assert.equal(cycle.status, 400);

    await app.api('PATCH', `/api/tasks/${first.task.id}`, { status: 'done' });
    workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.tasks.find(t => t.id === second.task.id).blocked, false);
    assert.equal((await app.api('GET', '/api/tasks')).body.tasks.some(t => t.id === second.task.id), true);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === second.task.id), true);
  });

  it('hides canceled work from planning surfaces and restores its schedule on reactivation', async () => {
    const { task } = await makeAssignment('Optional memo', 45);
    await app.api('PUT', '/api/schedule', { blocks: [{ id: 'cancel-block', taskId: task.id, day: new Date().toISOString().slice(0, 10), plannedMinutes: 45, title: task.title, course: task.course }] });
    await app.api('POST', `/api/tasks/${task.id}/cancel`, { reactivate: false });
    assert.equal((await app.api('GET', '/api/tasks')).body.tasks.some(t => t.id === task.id), false);
    let workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.tasks.find(t => t.id === task.id).displayState, 'canceled');
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === task.id), false);

    await app.api('POST', `/api/tasks/${task.id}/cancel`, { reactivate: true });
    workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.notEqual(workspace.tasks.find(t => t.id === task.id).displayState, 'canceled');
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(b => b.taskId === task.id), true);
  });

  it('continuously shrinks a scheduled non-reading block as progress is logged', async () => {
    const { task } = await makeAssignment('Draft response', 90);
    await app.api('PUT', '/api/schedule', { blocks: [{ id: 'work-block', taskId: task.id, day: new Date().toISOString().slice(0, 10), plannedMinutes: 90, title: task.title, course: task.course }] });
    const progress = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 30, focus: 7 });
    assert.equal(progress.status, 200);
    assert.equal(progress.body.task.estimatedMinutes, 60);
    const blocks = (await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].plannedMinutes, 60);
  });

  it('flags workload that cannot fit before its deadline as at risk', async () => {
    const { task } = await makeAssignment('Impossible deadline', 10000, 1);
    const workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    const found = workspace.tasks.find(t => t.id === task.id);
    assert.equal(found.atRisk, true);
    assert.match(found.atRiskReason, /Needs|Overdue/);
  });
});
