import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });
beforeEach(async () => { await app.reset(); });

const notebook = async (name) =>
  (await app.api('POST', '/api/notes/notebooks', { name, semester: name })).body.notebook;
const section = async (notebookId, name, parentId = null) =>
  (await app.api('POST', '/api/notes/sections', { notebookId, name, parentId })).body.section;
const page = async (notebookId, sectionId, title, content = '') =>
  (await app.api('POST', '/api/notes', { notebookId, sectionId, title, content })).body.note;

async function library() {
  const fall = await notebook('Fall 2026');
  const spring = await notebook('Spring 2027');
  const evidence = await section(fall.id, 'Evidence');
  const briefs = await section(fall.id, 'Case briefs', evidence.id);
  const classes = await section(fall.id, 'Class notes', evidence.id);
  const briefWeek = await section(fall.id, 'Week 1', briefs.id);
  const classWeek = await section(fall.id, 'Week 1', classes.id);
  await page(fall.id, briefWeek.id, 'Palsgraf brief', 'proximate cause and the zone of danger');
  await page(fall.id, classWeek.id, 'Evidence lecture 1', 'relevance conditioned on fact');
  await page(spring.id, null, 'Erie doctrine', 'vertical choice of law federalism');
  return { fall, spring, evidence, briefs, briefWeek, classWeek };
}

describe('what the assistant can see', () => {
  it('needs the token', async () => {
    assert.equal((await app.api('GET', '/api/gpt/notebooks')).status, 401);
    assert.equal((await app.api('GET', '/api/gpt/notes')).status, 401);
    const wrong = await app.api('GET', '/api/gpt/notes', undefined, { Authorization: 'Bearer nope' });
    assert.equal(wrong.status, 401);
  });

  it('can read the shape of the notebooks', async () => {
    const { fall } = await library();
    const { status, body } = await app.gpt('/api/gpt/notebooks');
    assert.equal(status, 200);

    const book = body.notebooks.find(n => n.id === fall.id);
    const evidence = book.sections.find(s => s.name === 'Evidence');
    const briefs = evidence.sections.find(s => s.name === 'Case briefs');
    assert.ok(briefs.sections.some(w => w.name === 'Week 1'), 'the nesting is visible all the way down');
  });

  it('can ask for one exact branch', async () => {
    const { briefWeek } = await library();
    const all = await app.gpt('/api/gpt/notes?limit=500');
    const branch = await app.gpt(`/api/gpt/notes?sectionId=${briefWeek.id}&limit=500`);

    assert.ok(branch.body.count > 0 && branch.body.count < all.body.count, 'the filter narrows');
    assert.ok(branch.body.matches.every(n => n.sectionId === briefWeek.id));
  });

  it('can ask for one notebook', async () => {
    const { spring } = await library();
    const { body } = await app.gpt(`/api/gpt/notes?notebookId=${spring.id}&limit=500`);
    assert.ok(body.count > 0);
    assert.ok(body.matches.every(n => n.notebookId === spring.id));
  });

  it('can combine a question with the hierarchy', async () => {
    const { fall, classWeek } = await library();
    const { body } = await app.gpt(
      `/api/gpt/notes?notebookId=${fall.id}&sectionId=${classWeek.id}&q=relevance&limit=500`,
    );
    assert.deepEqual(body.matches.map(n => n.title), ['Evidence lecture 1']);
  });

  it('never sees a page in the trash', async () => {
    const { fall, briefWeek } = await library();
    const binned = await page(fall.id, briefWeek.id, 'Binned', 'res ipsa loquitur');
    await app.api('DELETE', `/api/notes/${binned.id}`);

    const { body } = await app.gpt('/api/gpt/notes?q=loquitur&limit=500');
    assert.equal(body.count, 0);
  });

  it('publishes a spec that describes how to navigate', async () => {
    const { body } = await app.api('GET', '/api/gpt/openapi');
    const spec = JSON.stringify(body);
    assert.ok(spec.includes('listNotebooks'), 'the hierarchy endpoint is advertised');
    for (const parameter of ['"notebookId"', '"sectionId"', '"section"']) {
      assert.ok(spec.includes(parameter), `the spec documents ${parameter}`);
    }
  });
});
