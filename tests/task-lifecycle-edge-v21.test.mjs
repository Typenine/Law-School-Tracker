import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); await app.api('GET', '/api/tasks/workspace'); });
after(async () => { await app?.stop(); });
beforeEach(async () => {
  await app.reset();
  await app.db.query('TRUNCATE TABLE task_v2_meta, schedule_blocks, sessions, tasks CASCADE').catch(error => { if (error?.code !== '42P01') throw error; });
});

async function task(title, minutes = 60) {
  return (await app.api('POST', '/api/tasks', {
    title,
    dueDate: new Date(Date.now() + 3 * 864e5).toISOString(),
    activity: 'assignment',
    estimatedMinutes: minutes,
  })).body.task;
}

describe('task v2.1 lifecycle edges', () => {
  it('blocks and unschedules dependent work when a prerequisite is trashed, then restores it after the prerequisite is restored', async () => {
    const prerequisite = await task('Finish source review', 30);
    const dependent = await task('Draft memo', 60);
    await app.api('PATCH', `/api/tasks/${dependent.id}`, { dependsOn: [prerequisite.id] });
    await app.api('PATCH', `/api/tasks/${prerequisite.id}`, { status: 'done' });
    await app.api('PUT', '/api/schedule', { blocks: [{ id:'dependent-plan', taskId:dependent.id, day:new Date().toISOString().slice(0,10), plannedMinutes:60, title:dependent.title, course:'' }] });
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(block => block.taskId === dependent.id), true);

    await app.api('DELETE', `/api/tasks/${prerequisite.id}`);
    let workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.tasks.find(item => item.id === dependent.id).blocked, true);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(block => block.taskId === dependent.id), false);

    await app.api('POST', `/api/tasks/${prerequisite.id}/restore`, {});
    workspace = (await app.api('GET', '/api/tasks/workspace')).body;
    assert.equal(workspace.tasks.find(item => item.id === dependent.id).blocked, false);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.some(block => block.taskId === dependent.id), true);
  });

  it('keeps auto-generated reading titles synchronized with authoritative structured ranges', async () => {
    const created = (await app.api('POST', '/api/tasks', {
      title: 'Read pp. 100–150',
      dueDate: new Date(Date.now() + 3 * 864e5).toISOString(),
      activity: 'reading',
      originalPageRanges: '100-150',
      remainingPageRanges: '100-150',
      estimatedMinutes: 153,
    })).body.task;
    const updated = await app.api('PATCH', `/api/tasks/${created.id}`, { originalPageRanges: '100-175' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.task.title, 'Read pp. 100–175');
    assert.equal(updated.body.task.originalPageRanges, '100–175');
    assert.equal(updated.body.task.remainingPageRanges, '100–175');
  });
});
