
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });
beforeEach(async () => { await app.reset(); });

async function course() {
  return (await app.api('POST', '/api/courses', { title: 'Evidence', code: 'LAW 7191', semester: 'Fall', year: 2026, overrideEnabled: true, overrideMpp: 2 })).body.course;
}

async function reading() {
  await course();
  return (await app.api('POST', '/api/tasks', { title: 'Read pp. 100-150', course: 'Evidence', dueDate: new Date(Date.now() + 3 * 864e5).toISOString(), activity: 'reading', estimatedMinutes: 102 })).body.task;
}

describe('reading tracker v2', () => {
  it('stores page ranges and the real course relationship on creation', async () => {
    const task = await reading();
    assert.equal(task.originalPageRanges, '100–150');
    assert.equal(task.remainingPageRanges, '100–150');
    assert.equal(task.pagesRead, 51);
    assert.ok(task.courseId, 'courseId is persisted');
  });

  it('records partial progress atomically and keeps exact remaining pages', async () => {
    const task = await reading();
    const res = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 40, focus: 7, pagesCompleted: '100-119' });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.remainingPageRanges, '120–150');
    assert.equal(res.body.reading.completedPages, 20);
    assert.equal(res.body.reading.remainingPages, 31);
    const sessions = (await app.api('GET', '/api/sessions')).body.sessions.filter(s => s.taskId === task.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].pagesRead, 20);
  });

  it('rejects pages outside the remaining assignment without writing a session', async () => {
    const task = await reading();
    const res = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 10, focus: 5, pagesCompleted: '90-99' });
    assert.equal(res.status, 400);
    const sessions = (await app.api('GET', '/api/sessions')).body.sessions.filter(s => s.taskId === task.id);
    assert.equal(sessions.length, 0);
  });

  it('finishes a reading, clears remaining pages, and removes planned blocks', async () => {
    const task = await reading();
    await app.api('PUT', '/api/schedule', { blocks: [{ id:'block-1', taskId:task.id, day:new Date().toISOString().slice(0,10), plannedMinutes:60, title:task.title, course:'Evidence' }] });
    const res = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'finish', minutes: 90, focus: 8 });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, 'done');
    assert.equal(res.body.task.remainingPageRanges, null);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id).length, 0);
  });

  it('builds a reading dashboard and exposes linked note categories', async () => {
    const task = await reading();
    const notebook = (await app.api('POST', '/api/notes/notebooks', { name:'Evidence', course:'Evidence', semester:'Fall 2026' })).body.notebook;
    const briefs = (await app.api('POST', '/api/notes/sections', { notebookId:notebook.id, name:'Case Briefs' })).body.section;
    await app.api('POST', '/api/notes', { notebookId:notebook.id, sectionId:briefs.id, title:'Old Chief', content:'Rule 403', sourceType:'case-brief', taskId:task.id });
    const overview = await app.api('GET', '/api/reading/overview');
    const found = overview.body.readings.find(r => r.id === task.id);
    assert.equal(found.caseBriefCount, 1);
    assert.equal(found.assignedPages, 51);
  });

  it('smart-splits remaining pages into schedule blocks before the due date', async () => {
    const task = await reading();
    const split = await app.api('POST', `/api/tasks/${task.id}/smart-split`, {});
    assert.equal(split.status, 200);
    assert.ok(split.body.plan.length >= 1);
    const total = split.body.plan.reduce((sum, block) => sum + block.pages, 0);
    assert.equal(total, 51);
    const blocks = (await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id);
    assert.equal(blocks.length, split.body.plan.length);
  });

  it('gives the GPT exact reading progress for study planning', async () => {
    const task = await reading();
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode:'partial', minutes:30, focus:6, pagesCompleted:'100-109' });
    const { body } = await app.gpt('/api/gpt/assignments?activity=reading&status=all');
    const found = body.assignments.find(a => a.id === task.id);
    assert.equal(found.originalPageRanges, '100–150');
    assert.equal(found.remainingPageRanges, '110–150');
    assert.equal(found.assignedPages, 51);
    assert.equal(found.completedPages, 10);
    assert.equal(found.loggedMinutes, 30);
    assert.equal(typeof found.estimatedMinutesRemaining, 'number');
    const overview = await app.gpt('/api/gpt/overview');
    assert.ok(overview.body.openReadings.some(r => r.id === task.id));
  });
});
