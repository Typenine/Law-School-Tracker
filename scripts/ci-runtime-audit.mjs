const BASE_URL = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data };
}

async function requireAudit(path) {
  const { response, data } = await request(path);
  assert(response.ok, `${path} returned ${response.status}`);
  assert(data?.passed === true, `${path} failed: ${JSON.stringify(data?.checks?.filter(check => !check.passed) || data)}`);
  console.log(`PASS ${path} (${data.checks?.length || 0} checks)`);
}

async function smokeRoutes() {
  const routes = [
    '/', '/tasks', '/courses', '/courses/test-course', '/calendar', '/review',
    '/questions', '/outline-updates', '/exam', '/week-plan', '/wizard?course=test-course',
    '/settings', '/class-capture', '/work', '/api/events', '/api/semesters',
  ];
  for (const route of routes) {
    const { response } = await request(route);
    assert(response.status === 200, `${route} returned ${response.status}`);
    console.log(`PASS ${response.status} ${route}`);
  }
}

async function taskRoundTrip() {
  const dueDate = new Date(Date.now() + 86400000).toISOString();
  const created = await request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'CI task mutation audit', course: null, dueDate, status: 'todo', activity: 'other', tags: ['ci-audit'] }),
  });
  assert(created.response.status === 201, `Task create returned ${created.response.status}: ${JSON.stringify(created.data)}`);
  const taskId = created.data?.task?.id;
  assert(taskId, 'Task create did not return an id');

  try {
    const archived = await request(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done', completedAt: null, tags: ['ci-audit', 'task-lifecycle:archived'] }),
    });
    assert(archived.response.ok, `Task archive returned ${archived.response.status}`);
    assert(archived.data?.task?.completedAt === null, 'Archived task received a completion timestamp');
    console.log('PASS task create/archive lifecycle');
  } finally {
    const removed = await request(`/api/tasks/${taskId}`, { method: 'DELETE' });
    assert(removed.response.status === 204, `Task cleanup returned ${removed.response.status}`);
  }
}

async function eventRoundTrip() {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const created = await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ title: 'CI event mutation audit', category: 'school', date, allDay: true, course: 'CI Course' }),
  });
  assert(created.response.status === 201, `Event create returned ${created.response.status}: ${JSON.stringify(created.data)}`);
  const eventId = created.data?.event?.id;
  assert(eventId, 'Event create did not return an id');

  try {
    const updated = await request(`/api/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'CI event mutation audit updated' }),
    });
    assert(updated.response.ok && updated.data?.event?.title.endsWith('updated'), 'Event update was not persisted');
    const read = await request(`/api/events/${eventId}`);
    assert(read.response.ok && read.data?.event?.title.endsWith('updated'), 'Event read did not return updated value');
    console.log('PASS event create/update/read');
  } finally {
    const removed = await request(`/api/events/${eventId}`, { method: 'DELETE' });
    assert(removed.response.ok, `Event cleanup returned ${removed.response.status}`);
  }
}

async function workspaceConflictRoundTrip() {
  const courseId = `ci-course-${Date.now()}`;
  const initial = await request(`/api/course-workspace?courseId=${encodeURIComponent(courseId)}`);
  assert(initial.response.ok && initial.data?.revision === 0, 'Fresh workspace did not begin at revision 0');

  const first = await request('/api/course-workspace', {
    method: 'PATCH',
    body: JSON.stringify({ courseId, expectedRevision: 0, workspace: { outlineProgress: 10, questions: [] } }),
  });
  assert(first.response.ok && first.data?.revision === 1, 'First workspace update did not advance revision');

  const stale = await request('/api/course-workspace', {
    method: 'PATCH',
    body: JSON.stringify({ courseId, expectedRevision: 0, workspace: { outlineProgress: 20, questions: [] } }),
  });
  assert(stale.response.status === 409 && stale.data?.conflict === true, 'Stale workspace update was not rejected');
  console.log('PASS workspace revision conflict');
}

await requireAudit('/api/hardening-audit');
await requireAudit('/api/syllabus-audit');
await requireAudit('/api/academic-workflow-audit');
await smokeRoutes();
await taskRoundTrip();
await eventRoundTrip();
await workspaceConflictRoundTrip();
console.log('All runtime audits passed.');
