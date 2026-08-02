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

  it('stops counting a page once it is in the trash', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const first = await page(book.id, week.id, 'One');
    await page(book.id, week.id, 'Two');

    const before = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections
      .find(s => s.id === week.id);
    assert.equal(before.pageCount, 2);

    await app.api('DELETE', `/api/notes/${first.id}`);

    // The count is the most visible sign a delete worked. Leaving the trash in
    // it made deleting look like it had done nothing at all.
    const after = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections
      .find(s => s.id === week.id);
    assert.equal(after.pageCount, 1, 'the section count drops');

    const shelf = (await app.api('GET', '/api/notes/notebooks')).body.notebooks
      .find(n => n.id === book.id);
    assert.equal(shelf.noteCount, 1, 'and so does the notebook count');
  });

  it('counts a page again once it is restored', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const only = await page(book.id, week.id, 'One');
    await app.api('DELETE', `/api/notes/${only.id}`);
    await app.api('POST', '/api/notes/deleted', { id: only.id });

    const back = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections
      .find(s => s.id === week.id);
    assert.equal(back.pageCount, 1);
  });

  it('does not count archived pages either', async () => {
    const book = await notebook();
    const week = await section(book.id, 'Week 1');
    const filed = await page(book.id, week.id, 'Set aside');
    await app.api('PATCH', `/api/notes/${filed.id}`, { archived: true });

    const shelf = (await app.api('GET', '/api/notes/notebooks')).body.notebooks
      .find(n => n.id === book.id);
    assert.equal(shelf.noteCount, 0, 'the notebook count matches what the tree lists');
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

  it('still opens when the schema lock is held by a connection that is gone', async () => {
    const book = await notebook();
    await section(book.id, 'Week 1');

    // A deploy kills instances mid-migration, and an advisory lock lives until
    // its connection actually closes. `pg_advisory_lock` waits forever, so one
    // unlucky restart used to leave every later instance queued behind a lock
    // whose owner would never come back - a spinner that never resolved.
    const squatter = await app.db.connect();
    try {
      await squatter.query('SELECT pg_advisory_lock(4021977)');

      await app.restart();
      const started = Date.now();
      const response = await app.api('GET', '/api/notes/notebooks');
      const took = Date.now() - started;

      assert.equal(response.status, 200, 'the page can still load its notebooks');
      assert.ok(response.body.notebooks.some(n => n.id === book.id));
      assert.ok(took < 30_000, `gave up waiting rather than blocking (took ${took}ms)`);
    } finally {
      await squatter.query('SELECT pg_advisory_unlock(4021977)').catch(() => {});
      squatter.release();
    }
  });

  it('hands the schema connection back without its timeouts', async () => {
    // Those SETs are session-scoped and the connection is pooled, so leaving
    // them on would quietly apply a statement timeout to everything else.
    await app.api('GET', '/api/notes/notebooks');
    const { rows } = await app.db.query(
      `SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock`,
    );
    assert.equal(rows[0].statement, '0', 'no statement timeout left behind');
    assert.equal(rows[0].lock, '0', 'no lock timeout left behind');
  });

  it('clears out the tabs the old resurrection bug left behind', async () => {
    const book = await notebook();
    const briefs = await section(book.id, 'Case briefs');
    const week = await section(book.id, 'Week 1', briefs.id);
    await page(book.id, week.id, 'Palsgraf');

    // Exactly what the old migration used to insert: a top-level tab named
    // after whatever each page still says its section is called.
    await app.db.query(
      `INSERT INTO ai_note_sections (id, notebook_id, name)
       SELECT DISTINCT ON (note.notebook_id, LOWER(TRIM(note.section)))
         'section-' || md5(note.notebook_id || '|' || LOWER(TRIM(note.section))),
         note.notebook_id, TRIM(note.section)
       FROM ai_notes note
       WHERE note.notebook_id IS NOT NULL AND NULLIF(TRIM(note.section), '') IS NOT NULL
       ON CONFLICT DO NOTHING`,
    );
    const { rows: before } = await app.db.query(
      `SELECT COUNT(*)::int AS ghosts FROM ai_note_sections WHERE id LIKE 'section-%'`,
    );
    assert.ok(before[0].ghosts > 0, 'the polluted state was set up');

    await app.restart();

    const { rows: after } = await app.db.query(
      `SELECT COUNT(*)::int AS ghosts FROM ai_note_sections WHERE id LIKE 'section-%'`,
    );
    assert.equal(after[0].ghosts, 0, 'the unused duplicates are gone');
    const live = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    assert.ok(live.some(s => s.id === week.id), 'the real sections are untouched');
    assert.ok(live.some(s => s.id === briefs.id));
  });

  it('lets a section be renamed onto a name only a leftover held', async () => {
    const book = await notebook();
    const briefs = await section(book.id, 'Case briefs');
    const week = await section(book.id, 'Week 1', briefs.id);
    await page(book.id, week.id, 'Palsgraf');
    await app.db.query(
      `INSERT INTO ai_note_sections (id, notebook_id, name)
       VALUES ('section-' || md5($1 || '|week 1'), $1, 'Week 1') ON CONFLICT DO NOTHING`,
      [book.id],
    );

    // Before the cleanup this failed: the name was taken by a tab holding
    // nothing, which the user had no way to see or remove.
    await app.restart();
    const renamed = await app.api('PATCH', `/api/notes/sections/${briefs.id}`, { name: 'Week 1' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.section.name, 'Week 1');
  });

  it('never wipes a leftover tab that is actually holding pages', async () => {
    const book = await notebook();
    await section(book.id, 'Somewhere else');
    const { rows } = await app.db.query(
      `INSERT INTO ai_note_sections (id, notebook_id, name)
       VALUES ('section-' || md5($1 || '|legacy'), $1, 'Legacy') RETURNING id`,
      [book.id],
    );
    const legacy = rows[0].id;
    const kept = await page(book.id, null, 'Old page');
    await app.db.query(`UPDATE ai_notes SET section_id = $2 WHERE id = $1`, [kept.id, legacy]);

    await app.restart();
    const live = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    assert.ok(live.some(s => s.id === legacy), 'a legacy tab in use survives');
    assert.equal((await app.api('GET', `/api/notes/${kept.id}`)).body.note.sectionId, legacy);
  });

  it('re-files a page whose section vanished instead of hiding it', async () => {
    const book = await notebook();
    const home = await section(book.id, 'Case briefs');
    const doomed = await section(book.id, 'Week 1', home.id);
    const stranded = await page(book.id, doomed.id, 'Palsgraf');
    // Cut the section out from under it the way the old code could.
    await app.db.query(`DELETE FROM ai_note_sections WHERE id = $1`, [doomed.id]);

    await app.restart();
    const note = (await app.api('GET', `/api/notes/${stranded.id}`)).body.note;
    const live = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    assert.ok(note.sectionId, 'it is filed somewhere');
    assert.ok(live.some(s => s.id === note.sectionId), 'and that somewhere exists');
    assert.equal(note.section, live.find(s => s.id === note.sectionId).name, 'the stored name agrees');
  });

  it('does not conjure a "Notes" tab back after it has been renamed', async () => {
    const book = await notebook();
    const only = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections[0];
    assert.equal(only.name, 'Notes', 'a new notebook opens with one tab');
    await app.api('PATCH', `/api/notes/sections/${only.id}`, { name: 'Evidence' });

    // A page created without naming a section used to invent one called
    // "Notes", which read as the rename having been undone.
    await app.api('POST', '/api/notes', { notebookId: book.id, title: 'Fresh page', content: 'x' });

    const live = (await app.api('GET', `/api/notes/sections?notebookId=${book.id}`)).body.sections;
    assert.deepEqual(live.map(s => s.name), ['Evidence']);
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
