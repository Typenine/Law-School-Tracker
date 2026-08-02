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

describe('the trash does not grow forever', () => {
  it('publishes how long a deleted page is kept', async () => {
    const { body } = await app.api('GET', '/api/notes/deleted');
    assert.ok(Number(body.retentionDays) > 0, 'the window is stated, not implied');
  });

  it('throws out pages that have sat past the window', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const stale = await page(book.id, week.id, 'Long gone');
    const recent = await page(book.id, week.id, 'Just deleted');
    await app.api('DELETE', `/api/notes/${stale.id}`);
    await app.api('DELETE', `/api/notes/${recent.id}`);

    const { body: first } = await app.api('GET', '/api/notes/deleted');
    // Backdate one of them beyond the retention window.
    await app.db.query(
      `UPDATE ai_notes SET deleted_at = NOW() - ($2 || ' days')::interval WHERE id = $1`,
      [stale.id, String(first.retentionDays + 1)],
    );

    const { body } = await app.api('GET', '/api/notes/deleted');
    const ids = body.trashed.map(n => n.id);
    assert.ok(!ids.includes(stale.id), 'the expired page is gone');
    assert.ok(ids.includes(recent.id), 'the recent one is still recoverable');
    assert.equal((await app.api('GET', `/api/notes/${stale.id}`)).status, 404);
  });

  it('keeps a page that is one day short of the window', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const nearly = await page(book.id, week.id, 'Nearly out of time');
    await app.api('DELETE', `/api/notes/${nearly.id}`);

    const { body: first } = await app.api('GET', '/api/notes/deleted');
    await app.db.query(
      `UPDATE ai_notes SET deleted_at = NOW() - ($2 || ' days')::interval WHERE id = $1`,
      [nearly.id, String(first.retentionDays - 1)],
    );

    const { body } = await app.api('GET', '/api/notes/deleted');
    assert.ok(body.trashed.some(n => n.id === nearly.id));
  });

  it('never sweeps up an archived page', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const kept = await page(book.id, week.id, 'Archived on purpose');
    await app.api('PATCH', `/api/notes/${kept.id}`, { archived: true });
    await app.db.query(`UPDATE ai_notes SET updated_at = NOW() - INTERVAL '400 days' WHERE id = $1`, [kept.id]);

    const { body } = await app.api('GET', '/api/notes/deleted');
    assert.ok(body.archived.some(n => n.id === kept.id), 'archiving is not a slow delete');
  });

  it('empties the trash on request, and leaves the archive alone', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const binned = await page(book.id, week.id, 'Binned');
    const archived = await page(book.id, week.id, 'Archived');
    await app.api('DELETE', `/api/notes/${binned.id}`);
    await app.api('PATCH', `/api/notes/${archived.id}`, { archived: true });

    const emptied = await app.api('DELETE', '/api/notes/deleted');
    assert.equal(emptied.status, 200);
    assert.equal(emptied.body.purged, 1);

    const { body } = await app.api('GET', '/api/notes/deleted');
    assert.equal(body.trashed.length, 0);
    assert.ok(body.archived.some(n => n.id === archived.id));
    assert.equal((await app.api('GET', `/api/notes/${archived.id}`)).status, 200);
  });

  it('purges a page with images without disturbing one that shares them', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const shared = 'https://example.public.blob.vercel-storage.com/notes/shared.png';
    const html = `<p><img src="${shared}" alt="chart"></p>`;

    const original = await page(book.id, week.id, 'Original');
    const copy = await page(book.id, week.id, 'My copy');
    await app.api('PATCH', `/api/notes/${original.id}`, { contentHtml: html });
    await app.api('PATCH', `/api/notes/${copy.id}`, { contentHtml: html });

    await app.api('DELETE', `/api/notes/${copy.id}`);
    const purged = await app.api('DELETE', `/api/notes/${copy.id}?purge=true`);
    assert.equal(purged.status, 200);

    const survivor = (await app.api('GET', `/api/notes/${original.id}`)).body.note;
    assert.ok(survivor.contentHtml.includes(shared), 'the shared image is still referenced');
  });

  it('tells the user when a deleted page is due to go', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const binned = await page(book.id, week.id, 'Binned');
    await app.api('DELETE', `/api/notes/${binned.id}`);

    const { body } = await app.api('GET', '/api/notes/deleted');
    const found = body.trashed.find(n => n.id === binned.id);
    assert.ok(found.deletedAt, 'the deletion time comes back so a countdown can be shown');
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

  it('hands back enough of the winning version to show it side by side', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'first draft');

    const opened = (await app.api('GET', `/api/notes/${brief.id}`)).body.note.updatedAt;
    await new Promise(resolve => setTimeout(resolve, 1500));
    await app.api('PATCH', `/api/notes/${brief.id}`, { contentHtml: '<p>their edit</p>', expectedUpdatedAt: opened });

    const refused = await app.api('PATCH', `/api/notes/${brief.id}`, {
      contentHtml: '<p>my edit</p>', expectedUpdatedAt: opened,
    });
    assert.equal(refused.status, 409);
    assert.ok(refused.body.note.contentHtml.includes('their edit'), 'the editor can render what it is up against');
    assert.ok(refused.body.note.updatedAt, 'and knows the timestamp to overwrite from');
  });

  it('lets the user deliberately overwrite once they have seen the other version', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'first draft');

    const opened = (await app.api('GET', `/api/notes/${brief.id}`)).body.note.updatedAt;
    await new Promise(resolve => setTimeout(resolve, 1500));
    await app.api('PATCH', `/api/notes/${brief.id}`, { content: 'their edit', expectedUpdatedAt: opened });
    const refused = await app.api('PATCH', `/api/notes/${brief.id}`, {
      content: 'my edit', expectedUpdatedAt: opened,
    });

    // "Keep mine" re-sends against the timestamp that won, which is what
    // separates a deliberate overwrite from a blind retry.
    const forced = await app.api('PATCH', `/api/notes/${brief.id}`, {
      content: 'my edit', expectedUpdatedAt: refused.body.note.updatedAt,
    });
    assert.equal(forced.status, 200);
    assert.equal((await app.api('GET', `/api/notes/${brief.id}`)).body.note.content, 'my edit');
  });

  it('can keep both versions as separate pages', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Palsgraf', 'first draft');

    const opened = (await app.api('GET', `/api/notes/${brief.id}`)).body.note.updatedAt;
    await new Promise(resolve => setTimeout(resolve, 1500));
    await app.api('PATCH', `/api/notes/${brief.id}`, { content: 'their edit', expectedUpdatedAt: opened });

    // "Keep both" writes the losing version beside the winner rather than
    // over it, so nothing has to be rescued by hand.
    const copy = await app.api('POST', '/api/notes', {
      title: 'Palsgraf (my copy)', notebookId: book.id, sectionId: week.id, contentHtml: '<p>my edit</p>',
    });
    assert.equal(copy.status, 201);

    const inSection = (await app.api('GET', `/api/notes?notebookId=${book.id}`)).body.notes
      .filter(n => n.sectionId === week.id);
    assert.equal(inSection.length, 2, 'both survive');
    assert.equal((await app.api('GET', `/api/notes/${brief.id}`)).body.note.content, 'their edit');
    assert.match((await app.api('GET', `/api/notes/${copy.body.note.id}`)).body.note.content, /my edit/);
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
