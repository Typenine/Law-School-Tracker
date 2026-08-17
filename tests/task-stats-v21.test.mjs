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

describe('task v2.1 stats visibility', () => {
  it('does not let trashed or canceled work inflate current workload statistics', async () => {
    const due = new Date(Date.now() + 864e5).toISOString();
    const active = (await app.api('POST', '/api/tasks', { title:'Active task', dueDate:due, estimatedMinutes:60, activity:'assignment' })).body.task;
    const trashed = (await app.api('POST', '/api/tasks', { title:'Trashed task', dueDate:due, estimatedMinutes:120, activity:'assignment' })).body.task;
    const canceled = (await app.api('POST', '/api/tasks', { title:'Canceled task', dueDate:due, estimatedMinutes:180, activity:'assignment' })).body.task;
    await app.api('DELETE', `/api/tasks/${trashed.id}`);
    await app.api('POST', `/api/tasks/${canceled.id}/cancel`, { reactivate:false });
    const stats = (await app.api('GET', '/api/stats')).body;
    assert.equal(stats.upcoming7d, 1);
    assert.equal(stats.estMinutesThisWeek >= 0, true);
    const listed = (await app.api('GET', '/api/tasks')).body.tasks;
    assert.deepEqual(listed.map(t => t.id), [active.id]);
  });
});
