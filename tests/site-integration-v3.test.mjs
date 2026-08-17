import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;

async function resetSiteState() {
  await app.reset();
  // The archive table is created by the API in before(), so this truncate is
  // deterministic instead of being silently skipped when the first relation
  // does not exist. Courses are included because full-workspace backups must
  // not inherit fixtures from an earlier suite.
  await app.db.query('TRUNCATE TABLE workspace_archives, task_v2_meta, schedule_blocks, sessions, tasks, courses CASCADE');
  // Semesters live in the settings-backed collection rather than their own SQL
  // table. Clear them through the public API so this suite cannot leave an
  // active-term filter behind for the subsequent Chromium audits.
  const cleared = await app.api('PUT', '/api/semesters', { semesters: [] });
  assert.equal(cleared.status, 200);
}

before(async () => {
  app = await startApp();
  await app.api('GET', '/api/tasks/workspace');
  await app.api('GET', '/api/notes/notebooks');
  await app.api('GET', '/api/workspace/archives');
});

after(async () => {
  if (!app) return;
  await resetSiteState();
  await app.stop();
});

beforeEach(async () => {
  await resetSiteState();
});

async function course(title, year = 2026) {
  return (await app.api('POST', '/api/courses', { title, code: `LAW ${Math.floor(Math.random() * 9000) + 1000}`, semester: 'Fall', year })).body.course;
}

describe('site integration v3', () => {
  it('exports a restorable workspace backup', async () => {
    const evidence = await course('Evidence backup');
    const task = (await app.api('POST', '/api/tasks', {
      title: 'Read pp. 1-20', course: evidence.title, courseId: evidence.id,
      dueDate: new Date(Date.now() + 864e5).toISOString(), activity: 'reading', originalPageRanges: '1-20',
    })).body.task;

    const backupResponse = await app.api('GET', '/api/workspace/backup');
    assert.equal(backupResponse.status, 200);
    assert.equal(backupResponse.body.format, 'law-school-tracker-backup');
    assert.equal(backupResponse.body.version, 1);
    assert.ok(backupResponse.body.tables.courses.some(row => row.id === evidence.id));
    assert.ok(backupResponse.body.tables.tasks.some(row => row.id === task.id));

    await app.db.query('DELETE FROM tasks WHERE id=$1', [task.id]);
    await app.db.query('DELETE FROM courses WHERE id=$1', [evidence.id]);
    assert.equal((await app.db.query('SELECT id FROM courses WHERE id=$1', [evidence.id])).rowCount, 0);

    const restored = await app.api('POST', '/api/workspace/backup', { backup: backupResponse.body });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.restored, true);
    assert.equal((await app.db.query('SELECT id FROM courses WHERE id=$1', [evidence.id])).rowCount, 1);
    assert.equal((await app.db.query('SELECT id FROM tasks WHERE id=$1', [task.id])).rowCount, 1);
  });

  it('stores an immutable archive scoped to the selected semester', async () => {
    const semester = (await app.api('POST', '/api/semesters', {
      name: 'Fall 2026', season: 'Fall', year: 2026,
      startDate: '2026-08-24', endDate: '2026-12-10', isActive: true,
    })).body.semester;
    const evidence = await course('Evidence archive', 2026);
    const oldCourse = await course('Old archive course', 2025);
    const selectedTask = (await app.api('POST', '/api/tasks', {
      title: 'Evidence assignment', course: evidence.title, courseId: evidence.id, term: semester.id,
      dueDate: '2026-09-01T17:00:00.000Z', activity: 'assignment', estimatedMinutes: 60,
    })).body.task;
    await app.api('POST', '/api/tasks', {
      title: 'Old assignment', course: oldCourse.title, courseId: oldCourse.id, term: 'old-term',
      dueDate: '2025-09-01T17:00:00.000Z', activity: 'assignment', estimatedMinutes: 60,
    });

    const created = await app.api('POST', '/api/workspace/archives', { name: 'Fall 2026 final', semesterId: semester.id });
    assert.equal(created.status, 201);
    const archiveId = created.body.archive.id;
    const downloaded = await app.api('GET', `/api/workspace/archives/${archiveId}`);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.body.semesterId, semester.id);
    assert.ok(downloaded.body.tables.courses.some(row => row.id === evidence.id));
    assert.equal(downloaded.body.tables.courses.some(row => row.id === oldCourse.id), false);
    assert.ok(downloaded.body.tables.tasks.some(row => row.id === selectedTask.id));
    assert.equal(downloaded.body.tables.settings, undefined);
  });

  it('lists and deletes saved archives without changing the live workspace', async () => {
    const semester = (await app.api('POST', '/api/semesters', {
      name: 'Fall 2026', season: 'Fall', year: 2026,
      startDate: '2026-08-24', endDate: '2026-12-10', isActive: true,
    })).body.semester;
    const evidence = await course('Evidence live');
    const created = await app.api('POST', '/api/workspace/archives', { name: 'Snapshot', semesterId: semester.id });
    const id = created.body.archive.id;
    const listed = await app.api('GET', '/api/workspace/archives');
    assert.ok(listed.body.archives.some(item => item.id === id));
    assert.equal((await app.api('DELETE', `/api/workspace/archives/${id}`)).status, 204);
    assert.equal((await app.api('GET', '/api/workspace/archives')).body.archives.some(item => item.id === id), false);
    assert.equal((await app.db.query('SELECT id FROM courses WHERE id=$1', [evidence.id])).rowCount, 1);
  });
});
