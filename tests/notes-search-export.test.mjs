import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });
beforeEach(async () => { await app.reset(); });

const notebook = async (name, semester = name) =>
  (await app.api('POST', '/api/notes/notebooks', { name, semester })).body.notebook;
const section = async (notebookId, name, parentId = null) =>
  (await app.api('POST', '/api/notes/sections', { notebookId, name, parentId })).body.section;
const page = async (notebookId, sectionId, title, content = '') =>
  (await app.api('POST', '/api/notes', { notebookId, sectionId, title, content })).body.note;

async function library() {
  const fall = await notebook('Fall 2026');
  const spring = await notebook('Spring 2027');
  const evidence = await section(fall.id, 'Evidence');
  const briefs = await section(fall.id, 'Case briefs', evidence.id);
  const week = await section(fall.id, 'Week 1', briefs.id);
  const palsgraf = await page(fall.id, week.id, 'Palsgraf brief', 'proximate cause and the zone of danger');
  const erie = await page(spring.id, null, 'Erie doctrine', 'vertical choice of law federalism');
  return { fall, spring, evidence, briefs, week, palsgraf, erie };
}

describe('search', () => {
  it('reaches across every notebook, not just the open one', async () => {
    await library();
    const { body } = await app.api('GET', '/api/notes?q=federalism');
    assert.deepEqual(body.notes.map(n => n.title), ['Erie doctrine']);
  });

  it('reads the body of a page, not only its title', async () => {
    await library();
    const { body } = await app.api('GET', '/api/notes?q=proximate');
    assert.deepEqual(body.notes.map(n => n.title), ['Palsgraf brief']);
  });

  it('can still be narrowed to one notebook', async () => {
    const { spring } = await library();
    const { body } = await app.api('GET', `/api/notes?q=federalism&notebookId=${spring.id}`);
    assert.equal(body.notes.length, 1);
    const elsewhere = await app.api('GET', `/api/notes?q=federalism&notebookId=${(await notebook('Empty')).id}`);
    assert.equal(elsewhere.body.notes.length, 0);
  });

  it('never turns up a page from the trash', async () => {
    const { palsgraf } = await library();
    await app.api('DELETE', `/api/notes/${palsgraf.id}`);
    const { body } = await app.api('GET', '/api/notes?q=proximate');
    assert.equal(body.notes.length, 0);
  });

  it('returns nothing rather than everything when there is no match', async () => {
    await library();
    const { body } = await app.api('GET', '/api/notes?q=zzzznothinghere');
    assert.equal(body.notes.length, 0);
  });
});

describe('export', () => {
  it('sends one notebook as a markdown download in tree order', async () => {
    const { fall } = await library();
    const response = await fetch(`${app.base}/api/notes/export?notebookId=${fall.id}`);
    const markdown = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/markdown/);
    assert.match(response.headers.get('content-disposition'), /\.md"?$/);

    for (const heading of ['Evidence', 'Case briefs', 'Week 1', 'Palsgraf brief']) {
      assert.ok(markdown.includes(heading), `expected the export to include ${heading}`);
    }
    assert.ok(
      markdown.indexOf('Evidence') < markdown.indexOf('Case briefs')
      && markdown.indexOf('Case briefs') < markdown.indexOf('Week 1'),
      'sections come out in the order the tree shows them',
    );
    assert.ok(!markdown.includes('Erie doctrine'), 'and it stops at that notebook');
  });

  it('takes everything when no notebook is named', async () => {
    await library();
    const markdown = await (await fetch(`${app.base}/api/notes/export`)).text();
    assert.ok(markdown.includes('Palsgraf brief') && markdown.includes('Erie doctrine'));
  });

  it('leaves the trash out of a backup', async () => {
    const { fall, week } = await library();
    const binned = await page(fall.id, week.id, 'Binned draft', 'should not be exported');
    await app.api('DELETE', `/api/notes/${binned.id}`);

    const markdown = await (await fetch(`${app.base}/api/notes/export?notebookId=${fall.id}`)).text();
    assert.ok(!markdown.includes('Binned draft'));
  });

  it('says so when the notebook does not exist', async () => {
    const response = await fetch(`${app.base}/api/notes/export?notebookId=nope`);
    assert.equal(response.status, 404);
  });
});

describe('what gets stored when a page is saved', () => {
  it('keeps an https image and drops everything unsafe', async () => {
    const book = await notebook('Fall 2026');
    const week = await section(book.id, 'Week 1');
    const brief = await page(book.id, week.id, 'Diagram');

    const saved = await app.api('PATCH', `/api/notes/${brief.id}`, {
      contentHtml: '<p>see <img src="https://example.public.blob.vercel-storage.com/a.png" alt="chart">'
        + ' and <img src="http://insecure/x.png" alt="bad">'
        + '<script>alert(1)</script></p>',
    });

    const html = saved.body.note.contentHtml;
    assert.ok(html.includes('https://example.public.blob.vercel-storage.com/a.png'), 'the image survives');
    assert.ok(!html.includes('http://insecure'), 'a plain-http image does not');
    assert.ok(!html.includes('<script'), 'and neither does script');
    assert.match(saved.body.note.content, /\[image: chart\]/, 'the plain-text copy notes the image');
  });

  it('explains itself when there is nowhere to put an upload', async () => {
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'x.png');
    const response = await fetch(`${app.base}/api/notes/images`, { method: 'POST', body: form });

    // No blob store is bound in tests, so this must be a clear 503 rather than
    // a crash or a silent success that loses the picture.
    assert.equal(response.status, 503);
    assert.match(await response.text(), /configur/i);
  });
});
