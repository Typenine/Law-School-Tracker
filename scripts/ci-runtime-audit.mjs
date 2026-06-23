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
    '/api/notifications?generate=false', '/api/backup', '/api/cron/academic-maintenance',
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

async function activeSessionRoundTrip() {
  const taskId = `ci-active-${Date.now()}`;
  const record = {
    taskId,
    running: true,
    accumulatedSeconds: 42,
    startedAt: Date.now(),
    sessionStartedAt: new Date().toISOString(),
    notes: 'Cross-device draft',
    pages: '12',
    updatedAt: new Date().toISOString(),
  };
  const saved = await request('/api/active-session', { method: 'PUT', body: JSON.stringify(record) });
  assert(saved.response.ok && saved.data?.session?.notes === record.notes, 'Active session save failed');
  const loaded = await request(`/api/active-session?taskId=${encodeURIComponent(taskId)}`);
  assert(loaded.response.ok && loaded.data?.session?.pages === '12', 'Active session reload failed');
  const removed = await request(`/api/active-session?taskId=${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  assert(removed.response.ok && removed.data?.removed === true, 'Active session cleanup failed');
  console.log('PASS cross-device active session');
}

async function notificationRoundTrip() {
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ remindersEnabled: true, remindersLeadHours: 48, academicTimezone: 'America/New_York' }) });
  const dueDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const created = await request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'CI reminder audit', dueDate, status: 'todo', activity: 'other', tags: ['ci-reminder-audit'] }),
  });
  const taskId = created.data?.task?.id;
  assert(created.response.status === 201 && taskId, 'Reminder test task creation failed');
  try {
    const inbox = await request('/api/notifications');
    const notification = inbox.data?.notifications?.find(item => item.title.includes('CI reminder audit'));
    assert(inbox.response.ok && notification, 'Due-soon reminder was not generated');
    const dismissed = await request('/api/notifications', { method: 'PATCH', body: JSON.stringify({ id: notification.id, action: 'dismiss' }) });
    assert(dismissed.response.ok && dismissed.data?.notification?.dismissedAt, 'Notification dismissal was not persisted');
    console.log('PASS durable reminder generation and dismissal');
  } finally {
    await request(`/api/tasks/${taskId}`, { method: 'DELETE' });
  }
}

async function backupShapeAudit() {
  const backup = await request('/api/backup');
  assert(backup.response.ok, `Backup export returned ${backup.response.status}`);
  assert(backup.data?.format === 'law-school-tracker-backup' && backup.data?.version === 1, 'Backup metadata is invalid');
  assert(Array.isArray(backup.data?.tasks) && Array.isArray(backup.data?.courses) && Array.isArray(backup.data?.sessions), 'Backup data collections are missing');
  assert(backup.data?.settings && typeof backup.data.settings === 'object', 'Backup settings are missing');
  console.log('PASS full backup export structure');
}

await requireAudit('/api/hardening-audit');
await requireAudit('/api/syllabus-audit');
await requireAudit('/api/academic-workflow-audit');
await smokeRoutes();
await taskRoundTrip();
await eventRoundTrip();
await workspaceConflictRoundTrip();
await activeSessionRoundTrip();
await notificationRoundTrip();
await backupShapeAudit();
console.log('All runtime audits passed.');
