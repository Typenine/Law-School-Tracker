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
const gptWrite = (method, path, body) =>
  app.api(method, path, body, { Authorization: `Bearer ${app.token}` });

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
  return { fall, spring, evidence, briefs, classes, briefWeek, classWeek };
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

  it('searches a parent section recursively and returns a readable location path', async () => {
    const { briefs, briefWeek } = await library();
    const { status, body } = await app.gpt(`/api/gpt/notes?sectionId=${briefs.id}&q=proximate&limit=100`);
    assert.equal(status, 200);
    assert.deepEqual(body.matches.map(n => n.title), ['Palsgraf brief']);
    assert.ok(body.searchedSectionIds.includes(briefs.id));
    assert.ok(body.searchedSectionIds.includes(briefWeek.id));
    assert.match(body.matches[0].locationPath, /Fall 2026 \/ Evidence \/ Case briefs \/ Week 1/);
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
    assert.ok(['lexical', 'hybrid'].includes(body.retrievalMode));
  });

  it('filters by source type and topic', async () => {
    const fall = await notebook('Evidence');
    const cases = await section(fall.id, 'Case Briefs');
    await app.api('POST', '/api/notes', {
      notebookId: fall.id, sectionId: cases.id, title: 'Old Chief', content: 'Rule 403 stipulation', sourceType: 'case-brief', topics: ['403', 'relevance'],
    });
    await app.api('POST', '/api/notes', {
      notebookId: fall.id, sectionId: cases.id, title: 'Lecture', content: 'Rule 403 lecture', sourceType: 'class-notes', topics: ['relevance'],
    });
    const { body } = await app.gpt('/api/gpt/notes?q=403&sourceType=case-brief&topic=403&limit=100');
    assert.deepEqual(body.matches.map(n => n.title), ['Old Chief']);
  });

  it('never sees a page in the trash', async () => {
    const { fall, briefWeek } = await library();
    const binned = await page(fall.id, briefWeek.id, 'Binned', 'res ipsa loquitur');
    await app.api('DELETE', `/api/notes/${binned.id}`);

    const { body } = await app.gpt('/api/gpt/notes?q=loquitur&limit=500');
    assert.equal(body.count, 0);
    assert.equal((await app.gpt(`/api/gpt/notes/${binned.id}`)).status, 404);
  });

  it('can fetch several full notes at once for synthesis', async () => {
    const { fall, briefWeek, classWeek } = await library();
    const first = await page(fall.id, briefWeek.id, 'Brief A', 'first full body');
    const second = await page(fall.id, classWeek.id, 'Lecture B', 'second full body');
    const { status, body } = await app.gpt(`/api/gpt/notes/batch?ids=${first.id},${second.id}`);
    assert.equal(status, 200);
    assert.equal(body.count, 2);
    assert.deepEqual(new Set(body.notes.map(note => note.content)), new Set(['first full body', 'second full body']));
    assert.ok(body.notes.every(note => note.locationPath));
  });

  it('publishes a spec that describes how to navigate', async () => {
    const { body } = await app.api('GET', '/api/gpt/openapi');
    const spec = JSON.stringify(body);
    assert.ok(spec.includes('listNotebooks'), 'the hierarchy endpoint is advertised');
    for (const parameter of ['"notebookId"', '"sectionId"', '"section"', '"taskId"', '"sourceType"', '"topic"']) {
      assert.ok(spec.includes(parameter), `the spec documents ${parameter}`);
    }
    assert.match(body.info.description, /course\/notebook > nested sections > pages/);
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

  it('provides a study-planning overview', async () => {
    const fall = await notebook('Evidence');
    const classNotes = await section(fall.id, 'Class Notes');
    await page(fall.id, classNotes.id, 'Recent Evidence Notes', 'character evidence');
    await app.api('POST', '/api/tasks', {
      title: 'Evidence reading', course: 'Evidence', dueDate: new Date(Date.now() + 2 * 864e5).toISOString(),
    });
    const { status, body } = await app.gpt('/api/gpt/overview?days=7&recentNotes=5');
    assert.equal(status, 200);
    assert.ok(body.upcomingAssignments.some(task => task.title === 'Evidence reading'));
    assert.ok(body.recentNotes.some(note => note.title === 'Recent Evidence Notes'));
    assert.equal(typeof body.studyLast7Days.totalMinutes, 'number');
  });

  it('only performs the narrow write actions the connector advertises', async () => {
    const book = await notebook('Evidence');
    const outlines = await section(book.id, 'Outlines');
    const task = await app.api('POST', '/api/tasks', {
      title: 'Review hearsay', course: 'Evidence', dueDate: new Date(Date.now() + 864e5).toISOString(),
    });
    const taskId = task.body?.task?.id || task.body?.id;

    const created = await gptWrite('POST', '/api/gpt/notes/create', {
      title: 'Generated Hearsay Quiz', notebookId: book.id, sectionId: outlines.id,
      content: 'Question 1: identify hearsay.', sourceType: 'outline', topics: ['hearsay'],
    });
    assert.equal(created.status, 201);
    const noteId = created.body.note.id;

    const appended = await gptWrite('POST', `/api/gpt/notes/${noteId}/append`, {
      heading: 'Answer key', content: 'Answer 1: analyze statement, declarant, and purpose.',
    });
    assert.equal(appended.status, 200);
    assert.match(appended.body.note.content, /Answer 1/);

    const linked = await gptWrite('POST', `/api/gpt/notes/${noteId}/link-assignment`, { taskId });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.note.taskId, taskId);
    assert.equal((await app.api('POST', '/api/gpt/notes/create', { title: 'No token', notebookId: book.id, content: 'x' })).status, 401);
  });

  it('publishes a schema that resolves, so the import does not bounce', async () => {
    const { body: spec } = await app.api('GET', '/api/gpt/openapi');

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
      [
        'appendToNote', 'createStudyNote', 'getNote', 'getNotes', 'getWorkspaceOverview',
        'linkNoteToAssignment', 'listAssignments', 'listCourses', 'listNotebooks',
        'listStudySessions', 'searchNotes',
      ],
    );
  });

  it('advertises a callback URL the assistant can actually reach', async () => {
    const response = await fetch(`${app.base}/api/gpt/openapi`, {
      headers: { 'x-forwarded-host': 'law-school-tracker.example.app', 'x-forwarded-proto': 'https' },
    });
    const spec = await response.json();
    assert.equal(spec.servers[0].url, 'https://law-school-tracker.example.app');

    const plain = await (await fetch(`${app.base}/api/gpt/openapi`)).json();
    assert.ok(plain.servers[0].url.startsWith('http://127.0.0.1:'), plain.servers[0].url);
  });
});
