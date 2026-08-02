import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });
beforeEach(async () => { await app.reset(); });

const notebook = async (name = 'Fall 2026') =>
  (await app.api('POST', '/api/notes/notebooks', { name, semester: name })).body.notebook;
const section = async (notebookId, name, parentId = null) =>
  (await app.api('POST', '/api/notes/sections', { notebookId, name, parentId })).body.section;
const page = async (notebookId, sectionId, title, content = '') =>
  (await app.api('POST', '/api/notes', { notebookId, sectionId, title, content })).body.note;

describe('nothing is destroyed by accident', () => {
  it('deleting a page puts it in the trash', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'proximate cause');

    const removed = await app.api('DELETE', `/api/notes/${brief.id}`);
    assert.equal(removed.body.purged, false);

    const listed = (await app.api('GET', `/api/notes?notebookId=${book.id}`)).body.notes;
    assert.ok(!listed.some(n => n.id === brief.id), 'it leaves the page list');

    const trashed = (await app.api('GET', '/api/notes/deleted')).body.trashed;
    assert.ok(trashed.some(n => n.id === brief.id), 'and turns up in the trash');
  });

  it('restore brings a page back where it was, with its text', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'proximate cause');
    await app.api('DELETE', `/api/notes/${brief.id}`);

    const restored = await app.api('POST', '/api/notes/deleted', { id: brief.id });
    assert.equal(restored.status, 200);

    const back = (await app.api('GET', `/api/notes/${brief.id}`)).body.note;
    assert.equal(back.sectionId, week.id);
    assert.equal(back.content, 'proximate cause');
  });

  it('a page restored into a deleted section is re-filed somewhere visible', async () => {
    const book = await notebook();
    const doomed = await section(book.id, 'Week 2');
    const brief = await page(book.id, doomed.id, 'Palsgraf');
    await app.api('DELETE', `/api/notes/sections/${doomed.id}?deletePages=true`);
    await app.api('POST', '/api/notes/deleted', { id: brief.id });

    const back = (await app.api('GET', `/api/notes/${brief.id}`)).body.note;
    const live = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    assert.ok(back.sectionId, 'it is filed');
    assert.ok(live.some(s => s.id === back.sectionId), 'and the folder it is filed in exists');
  });

  it('an archived page can be found and brought back', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf');

    await app.api('PATCH', `/api/notes/${brief.id}`, { archived: true });
    const setAside = (await app.api('GET', '/api/notes/deleted')).body;
    assert.ok(setAside.archived.some(n => n.id === brief.id));

    await app.api('POST', '/api/notes/deleted', { id: brief.id });
    assert.equal((await app.api('GET', `/api/notes/${brief.id}`)).body.note.archived, false);
  });

  it('only an explicit purge destroys anything', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf');
    await app.api('DELETE', `/api/notes/${brief.id}`);

    const purged = await app.api('DELETE', `/api/notes/${brief.id}?purge=true`);
    assert.equal(purged.body.purged, true);
    assert.equal((await app.api('GET', `/api/notes/${brief.id}`)).status, 404);
    const trashed = (await app.api('GET', '/api/notes/deleted')).body.trashed;
    assert.ok(!trashed.some(n => n.id === brief.id));
  });
});

describe('two tabs editing the same page', () => {
  it('refuses the second write instead of clobbering the first', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'first draft');

    const opened = (await app.api('GET', `/api/notes/${brief.id}`)).body.note.updatedAt;
    // The conflict check allows a second of slack, so let the clock move on.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const mine = await app.api('PATCH', `/api/notes/${brief.id}`, {
      content: 'my edit', expectedUpdatedAt: opened,
    });
    assert.equal(mine.status, 200);

    const theirs = await app.api('PATCH', `/api/notes/${brief.id}`, {
      content: 'their edit', expectedUpdatedAt: opened,
    });
    assert.equal(theirs.status, 409);
    assert.equal(theirs.body.note.content, 'my edit', 'the 409 carries the version that won');
    assert.equal((await app.api('GET', `/api/notes/${brief.id}`)).body.note.content, 'my edit');
  });

  it('still accepts an ordinary autosave, which sends no timestamp', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'first draft');

    const saved = await app.api('PATCH', `/api/notes/${brief.id}`, { content: 'typing away' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.note.content, 'typing away');
  });
});

describe('what survives a restart', () => {
  it('does not resurrect sections the user deleted', async () => {
    const book = await notebook();
    const keep = await section(book.id, 'Week 1');
    const doomed = await section(book.id, 'Week 2');
    await page(book.id, doomed.id, 'Moved out');
    // The default keeps the pages, which leaves the deleted name on them - the
    // exact state that used to bring the folder back on the next boot.
    await app.api('DELETE', `/api/notes/sections/${doomed.id}`);

    const before = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    await app.restart();
    const after = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;

    assert.deepEqual(
      after.map(s => s.name).sort(),
      before.map(s => s.name).sort(),
      'the section list is the same after a restart',
    );
    assert.ok(!after.some(s => s.name === 'Week 2'), 'the deleted folder stayed deleted');
    assert.ok(after.some(s => s.id === keep.id));
  });

  it('does not resurrect a section from a page sitting in the trash', async () => {
    const book = await notebook();
    await section(book.id, 'Week 1');
    const doomed = await section(book.id, 'Week 2');
    await page(book.id, doomed.id, 'Binned');
    await app.api('DELETE', `/api/notes/sections/${doomed.id}?deletePages=true`);

    await app.restart();
    const after = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    assert.ok(!after.some(s => s.name === 'Week 2'));
  });

  it('keeps deleted pages deleted', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf');
    await app.api('DELETE', `/api/notes/${brief.id}`);

    await app.restart();
    const listed = (await app.api('GET', `/api/notes?notebookId=${book.id}`)).body.notes;
    assert.ok(!listed.some(n => n.id === brief.id));
  });
});
