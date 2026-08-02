import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });
beforeEach(async () => { await app.reset(); });

const notebook = async (name, semester) =>
  (await app.api('POST', '/api/notes/notebooks', { name, semester })).body.notebook;
const section = async (notebookId, name, parentId = null) =>
  (await app.api('POST', '/api/notes/sections', { notebookId, name, parentId })).body.section;
const page = async (notebookId, sectionId, title, content = '') =>
  (await app.api('POST', '/api/notes', { notebookId, sectionId, title, content })).body.note;

describe('the notebook hierarchy', () => {
  it('nests as deep as the user files things', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const evidence = await section(fall.id, 'Evidence');
    const briefs = await section(fall.id, 'Case briefs', evidence.id);
    const week = await section(fall.id, 'Week 1', briefs.id);

    const { body } = await app.api('GET', `/api/notes/sections?notebookId=${fall.id}`);
    const byId = Object.fromEntries(body.sections.map(s => [s.id, s]));
    assert.equal(byId[week.id].parentId, briefs.id);
    assert.equal(byId[briefs.id].parentId, evidence.id);
    assert.equal(byId[evidence.id].parentId, null);
  });

  it('allows the same section name under different parents', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const evidence = await section(fall.id, 'Evidence');
    const briefs = await section(fall.id, 'Case briefs', evidence.id);
    const classes = await section(fall.id, 'Class notes', evidence.id);

    const first = await section(fall.id, 'Week 1', briefs.id);
    const second = await section(fall.id, 'Week 1', classes.id);
    assert.notEqual(first.id, second.id, 'two Week 1 folders under different categories are different folders');
  });

  it('refuses two sections with the same name under one parent', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const evidence = await section(fall.id, 'Evidence');
    const first = await section(fall.id, 'Week 1', evidence.id);
    const again = await section(fall.id, 'week 1', evidence.id);
    assert.equal(again.id, first.id, 'the existing folder is reused rather than duplicated');
  });

  it('gives a new notebook somewhere to write straight away', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const created = await app.api('POST', '/api/notes', {
      notebookId: fall.id, title: 'First page', content: 'hello',
    });
    assert.equal(created.status, 201);
    assert.ok(created.body.note.sectionId, 'the page was filed, not left loose');
  });

  it('renaming a section follows through to its pages', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const week = await section(fall.id, 'Week 1');
    const brief = await page(fall.id, week.id, 'Palsgraf');

    await app.api('PATCH', `/api/notes/sections/${week.id}`, { name: 'Week One' });
    const { body } = await app.api('GET', `/api/notes/${brief.id}`);
    assert.equal(body.note.section, 'Week One');
  });

  it('a rename does not catch up same-named folders elsewhere', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const briefs = await section(fall.id, 'Case briefs');
    const classes = await section(fall.id, 'Class notes');
    const inBriefs = await section(fall.id, 'Week 1', briefs.id);
    const inClasses = await section(fall.id, 'Week 1', classes.id);
    const a = await page(fall.id, inBriefs.id, 'A');
    const b = await page(fall.id, inClasses.id, 'B');

    await app.api('PATCH', `/api/notes/sections/${inBriefs.id}`, { name: 'Week One' });
    assert.equal((await app.api('GET', `/api/notes/${a.id}`)).body.note.section, 'Week One');
    assert.equal((await app.api('GET', `/api/notes/${b.id}`)).body.note.section, 'Week 1');
  });
});

describe('moving pages around', () => {
  it('a page can be dropped into another section', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const from = await section(fall.id, 'Week 1');
    const to = await section(fall.id, 'Week 2');
    const brief = await page(fall.id, from.id, 'Palsgraf');

    const moved = await app.api('PATCH', `/api/notes/${brief.id}`, { sectionId: to.id, position: 0 });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.note.sectionId, to.id);
    assert.equal(moved.body.note.section, 'Week 2', 'the stored section name follows the move');
  });

  it('keeps the order pages were dropped in', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const week = await section(fall.id, 'Week 1');
    const first = await page(fall.id, week.id, 'First');
    const second = await page(fall.id, week.id, 'Second');

    await app.api('PATCH', `/api/notes/${second.id}`, { sectionId: week.id, position: 0 });
    const { body } = await app.api('GET', `/api/notes?notebookId=${fall.id}`);
    const ordered = body.notes
      .filter(n => n.sectionId === week.id)
      .sort((a, b) => a.position - b.position)
      .map(n => n.title);
    assert.deepEqual(ordered, ['Second', 'First']);
  });
});

describe('deleting a section', () => {
  it('keeps the pages by default, moving them somewhere real', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    await section(fall.id, 'Week 1');
    const doomed = await section(fall.id, 'Week 2');
    const brief = await page(fall.id, doomed.id, 'Palsgraf');

    const removed = await app.api('DELETE', `/api/notes/sections/${doomed.id}`);
    assert.equal(removed.body.deletedPages, 0, 'nothing was deleted');
    assert.ok(removed.body.movedTo, 'the pages were rehoused');

    const after = (await app.api('GET', `/api/notes/${brief.id}`)).body.note;
    const live = (await app.api('GET', `/api/notes/sections?notebookId=${fall.id}`)).body.sections;
    assert.notEqual(after.sectionId, doomed.id);
    assert.ok(live.some(s => s.id === after.sectionId), 'and the folder they landed in exists');
  });

  it('sends the whole subtree to the trash when asked', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    await section(fall.id, 'Somewhere else');
    const doomed = await section(fall.id, 'Week 2');
    const nested = await section(fall.id, 'Sub', doomed.id);
    const outer = await page(fall.id, doomed.id, 'Outer');
    const inner = await page(fall.id, nested.id, 'Inner');

    const removed = await app.api('DELETE', `/api/notes/sections/${doomed.id}?deletePages=true`);
    assert.equal(removed.body.deletedPages, 2);

    const trashed = (await app.api('GET', '/api/notes/deleted')).body.trashed.map(n => n.id);
    assert.ok(trashed.includes(outer.id) && trashed.includes(inner.id), 'both pages are recoverable');

    const left = (await app.api('GET', `/api/notes/sections?notebookId=${fall.id}`)).body.sections.map(s => s.id);
    assert.ok(!left.includes(doomed.id) && !left.includes(nested.id), 'the nested section went too');
  });

  it('leaves no page pointing at a section that is gone', async () => {
    const fall = await notebook('Fall 2026', 'Fall 2026');
    const doomed = await section(fall.id, 'Week 2');
    await page(fall.id, doomed.id, 'Orphan');
    await app.api('DELETE', `/api/notes/sections/${doomed.id}?deletePages=true`);

    const { rows } = await app.db.query(
      `SELECT COUNT(*)::int AS dangling FROM ai_notes note
       WHERE note.section_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ai_note_sections s WHERE s.id = note.section_id)`,
    );
    assert.equal(rows[0].dangling, 0);
  });
});
