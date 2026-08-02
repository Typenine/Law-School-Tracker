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
    for (const parameter of ['"notebookId"', '"sectionId"', '"section"', '"taskId"']) {
      assert.ok(spec.includes(parameter), `the spec documents ${parameter}`);
    }
  });

  it('can go from a reading assignment to the notes on it', async () => {
    const fall = await notebook('Fall 2026');
    const week = await section(fall.id, 'Week 1');
    await app.api('POST', '/api/notes', {
      notebookId: fall.id, sectionId: week.id, title: 'Palsgraf brief', content: 'zone of danger', taskId: 'task-77',
    });
    await page(fall.id, week.id, 'Something else', 'unrelated');

    const { status, body } = await app.gpt('/api/gpt/notes?taskId=task-77&limit=100');
    assert.equal(status, 200);
    assert.deepEqual(body.matches.map(n => n.title), ['Palsgraf brief']);
    assert.equal(body.matches[0].taskId, 'task-77', 'the link comes back so it can be cited');
  });

  it('reports a page’s pictures rather than dropping them', async () => {
    const fall = await notebook('Fall 2026');
    const week = await section(fall.id, 'Week 1');
    const created = await page(fall.id, week.id, 'Diagram');
    const url = 'https://example.public.blob.vercel-storage.com/notes/flow.png';
    await app.api('PATCH', `/api/notes/${created.id}`, {
      contentHtml: `<p>the framework</p><p><img src="${url}" alt="burden-shifting chart"></p>`,
    });

    const { body } = await app.gpt(`/api/gpt/notes/${created.id}`);
    assert.deepEqual(body.note.images, [url]);
    assert.match(body.note.content, /\[image: burden-shifting chart\]/);
    assert.equal(body.note.contentHtml, undefined, 'the assistant still gets prose, not markup');
  });

  it('counts each assignment’s notes so it knows there is something to read', async () => {
    const fall = await notebook('Fall 2026');
    const week = await section(fall.id, 'Week 1');
    const task = await app.api('POST', '/api/tasks', {
      title: 'Read Palsgraf', course: 'Torts', dueDate: new Date(Date.now() + 864e5).toISOString(),
    });
    const taskId = task.body?.task?.id || task.body?.id;
    await app.api('POST', '/api/notes', {
      notebookId: fall.id, sectionId: week.id, title: 'My brief', content: 'x', taskId,
    });

    const { body } = await app.gpt('/api/gpt/assignments?status=all&limit=100');
    const found = body.assignments.find(a => a.id === taskId);
    assert.equal(found.noteCount, 1);
  });

  it('exposes the study log, with totals over everything matched', async () => {
    const { status, body } = await app.gpt('/api/gpt/sessions');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.sessions));
    assert.equal(typeof body.totalMinutes, 'number');
    assert.equal((await app.api('GET', '/api/gpt/sessions')).status, 401, 'and it needs the token');
  });

  it('publishes a schema that resolves, so the import does not bounce', async () => {
    const { body: spec } = await app.api('GET', '/api/gpt/openapi');

    // A single dangling $ref makes ChatGPT reject the whole Action at import
    // time, which looks from the outside like the connector returning nothing.
    const refs = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.push(value);
        else walk(value);
      }
    };
    walk(spec);
    assert.ok(refs.length > 0, 'the spec uses shared components');

    for (const ref of refs) {
      assert.ok(ref.startsWith('#/'), `only local refs are usable here: ${ref}`);
      let node = spec;
      for (const step of ref.slice(2).split('/')) {
        node = node?.[step];
        assert.ok(node !== undefined, `${ref} does not resolve`);
      }
    }

    // Every operation the assistant can call needs a unique id.
    const ids = [];
    for (const item of Object.values(spec.paths)) {
      for (const operation of Object.values(item)) {
        assert.ok(operation.operationId, 'every operation is named');
        ids.push(operation.operationId);
      }
    }
    assert.equal(new Set(ids).size, ids.length, `duplicate operationId in ${ids.join(', ')}`);
    assert.deepEqual(
      ids.sort(),
      ['getNote', 'listAssignments', 'listCourses', 'listNotebooks', 'listStudySessions', 'searchNotes'],
    );
  });

  it('advertises a callback URL the assistant can actually reach', async () => {
    // Behind a proxy the request origin is not the public one. Whatever lands
    // in `servers` is what ChatGPT calls, so it has to follow the forwarded
    // headers rather than the socket this process was handed.
    const response = await fetch(`${app.base}/api/gpt/openapi`, {
      headers: { 'x-forwarded-host': 'law-school-tracker.example.app', 'x-forwarded-proto': 'https' },
    });
    const spec = await response.json();
    assert.equal(spec.servers[0].url, 'https://law-school-tracker.example.app');

    const plain = await (await fetch(`${app.base}/api/gpt/openapi`)).json();
    assert.ok(plain.servers[0].url.startsWith('http://127.0.0.1:'), plain.servers[0].url);
  });
});
