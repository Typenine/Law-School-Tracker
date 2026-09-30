import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;

test.before(async () => {
  app = await startApp();
});

test.after(async () => {
  await app?.stop();
});

test('MCP health endpoint exposes only non-sensitive connection metadata', async () => {
  const response = await app.api('GET', '/api/mcp');
  assert.equal(response.status, 200);
  assert.equal(response.body.name, 'law-school-tracker-mcp');
  assert.equal(response.body.authScheme, 'Authorization: Bearer <LAW_SCHOOL_GPT_TOKEN>');
  assert.equal(response.body.access, 'private');
  assert.equal(response.body.readOnly, true);
  assert.ok(response.body.tools.includes('search_notes'));
  assert.ok(response.body.tools.includes('get_note'));
});

test('MCP POST requires the existing Law School Tracker bearer token', async () => {
  const unauthenticated = await app.api('POST', '/api/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  assert.equal(unauthenticated.status, 401);

  const authenticated = await app.api(
    'POST',
    '/api/mcp',
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { Authorization: `Bearer ${app.token}` },
  );
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.result.tools.length, 8);
  assert.ok(authenticated.body.result.tools.every(tool => tool.annotations?.readOnlyHint === true));
});

test('MCP initialize handshake returns server identity and study instructions', async () => {
  const response = await app.api(
    'POST',
    '/api/mcp',
    { jsonrpc: '2.0', id: 3, method: 'initialize', params: {} },
    { Authorization: `Bearer ${app.token}` },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.result.protocolVersion, '2025-03-26');
  assert.equal(response.body.result.serverInfo.name, 'law-school-tracker-mcp');
  assert.match(response.body.result.instructions, /search_notes/);
});

test('MCP can call canonical tracker endpoints without duplicating storage logic', async () => {
  const courses = await app.api(
    'POST',
    '/api/mcp',
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_courses', arguments: {} } },
    { Authorization: `Bearer ${app.token}` },
  );
  assert.equal(courses.status, 200);
  assert.equal(courses.body.result.isError, false);
  assert.ok(Array.isArray(courses.body.result.structuredContent.courses));

  const notes = await app.api(
    'POST',
    '/api/mcp',
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search_notes', arguments: { q: 'evidence' } } },
    { Authorization: `Bearer ${app.token}` },
  );
  assert.equal(notes.status, 200);
  assert.equal(notes.body.result.isError, false);
  assert.ok(Array.isArray(notes.body.result.structuredContent.matches));
});
