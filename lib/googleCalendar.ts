import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getSettings, patchSettings, listCourses, listTasks } from './storage';
import type { CalendarEvent, Course, Task } from './types';

const PRIVATE_KEY = 'googleCalendarPrivateV1';
const PUBLIC_KEY = 'googleCalendarPublicV1';
const EVENTS_KEY = 'calendarEventsV1';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

type TokenPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
};

type PrivateConnection = {
  tokens: TokenPayload;
  calendarId: string;
  calendarName?: string;
};

type PublicConnection = {
  connected: boolean;
  calendarId?: string;
  calendarName?: string;
  lastSyncedAt?: string;
  lastSyncSummary?: Record<string, number>;
};

function oauthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Google Calendar OAuth is not configured.');
  return { clientId, clientSecret };
}

function encryptionKey() {
  const secret = process.env.GOOGLE_CALENDAR_TOKEN_KEY || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!secret) throw new Error('GOOGLE_CALENDAR_TOKEN_KEY is not configured.');
  return createHash('sha256').update(secret).digest();
}

function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function decrypt<T>(payload: any): T {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext) throw new Error('Google Calendar connection is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

export function googleCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.GOOGLE_CALENDAR_TOKEN_KEY || process.env.GOOGLE_CLIENT_SECRET));
}

export function buildGoogleAuthUrl(redirectUri: string, state: string) {
  const { clientId } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${await response.text()}`);
  const data = await response.json();
  const tokens: TokenPayload = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
  const primary = await googleFetch(tokens, '/users/me/calendarList?minAccessRole=reader');
  const calendar = (primary.items || []).find((item: any) => item.primary) || primary.items?.[0];
  const connection: PrivateConnection = { tokens, calendarId: calendar?.id || 'primary', calendarName: calendar?.summary || 'Primary calendar' };
  await patchSettings({ [PRIVATE_KEY]: encrypt(connection), [PUBLIC_KEY]: { connected: true, calendarId: connection.calendarId, calendarName: connection.calendarName } });
  return connection;
}

async function getConnection(): Promise<PrivateConnection | null> {
  const settings = await getSettings([PRIVATE_KEY]);
  const payload = settings[PRIVATE_KEY];
  if (!payload) return null;
  return decrypt<PrivateConnection>(payload);
}

async function saveConnection(connection: PrivateConnection) {
  await patchSettings({ [PRIVATE_KEY]: encrypt(connection), [PUBLIC_KEY]: { connected: true, calendarId: connection.calendarId, calendarName: connection.calendarName } });
}

async function refreshTokens(connection: PrivateConnection) {
  if (connection.tokens.expiresAt && connection.tokens.expiresAt > Date.now() + 60_000) return connection;
  if (!connection.tokens.refreshToken) throw new Error('Google Calendar needs to be reconnected.');
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: connection.tokens.refreshToken, grant_type: 'refresh_token' }),
  });
  if (!response.ok) throw new Error('Google Calendar access could not be refreshed.');
  const data = await response.json();
  connection.tokens = { ...connection.tokens, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, scope: data.scope || connection.tokens.scope };
  await saveConnection(connection);
  return connection;
}

async function googleFetch(tokens: TokenPayload, path: string, init?: RequestInit) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) throw new Error(`Google Calendar API ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

function hashEvent(event: any) {
  return createHash('sha256').update(JSON.stringify({ summary: event.summary, description: event.description, location: event.location, start: event.start, end: event.end, recurrence: event.recurrence })).digest('hex').slice(0, 24);
}

function taskEvent(task: Task, timezone: string) {
  const date = task.dueDate.slice(0, 10);
  const timed = Boolean(task.startTime);
  const start = timed ? { dateTime: `${date}T${task.startTime}:00`, timeZone: timezone } : { date };
  const end = timed ? { dateTime: `${date}T${task.endTime || task.startTime}:00`, timeZone: timezone } : { date: nextDate(date) };
  return { summary: task.title, description: [task.course, task.notes].filter(Boolean).join('\n\n'), start, end, extendedProperties: { private: { lstManaged: 'true', lstSource: 'task', lstId: task.id } } };
}

function localEvent(event: CalendarEvent & Record<string, any>, timezone: string) {
  const timed = Boolean(event.startTime) && !event.allDay;
  const start = timed ? { dateTime: `${event.date}T${event.startTime}:00`, timeZone: timezone } : { date: event.date };
  const end = timed ? { dateTime: `${event.date}T${event.endTime || event.startTime}:00`, timeZone: timezone } : { date: nextDate(event.date) };
  return { summary: event.title, description: event.description || '', location: event.location || '', start, end, recurrence: event.recurrenceRule ? [event.recurrenceRule] : undefined, extendedProperties: { private: { lstManaged: 'true', lstSource: 'event', lstId: event.id } } };
}

function courseEvents(course: Course, timezone: string) {
  const blocks = course.meetingBlocks?.length ? course.meetingBlocks : course.meetingDays?.length && course.meetingStart && course.meetingEnd ? [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd, location: course.location || course.room }] : [];
  return blocks.map((block, index) => {
    const first = firstOccurrence(course.startDate?.slice(0, 10) || new Date().toISOString().slice(0, 10), block.days);
    const until = (course.endDate?.slice(0, 10) || first).replace(/-/g, '') + 'T235959Z';
    return { key: `${course.id}:${index}`, body: { summary: course.title, description: [course.code, course.instructor].filter(Boolean).join(' · '), location: block.location || course.location || course.room || '', start: { dateTime: `${first}T${block.start}:00`, timeZone: timezone }, end: { dateTime: `${first}T${block.end}:00`, timeZone: timezone }, recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${block.days.map(dayCode).join(',')};UNTIL=${until}`], extendedProperties: { private: { lstManaged: 'true', lstSource: 'course', lstId: `${course.id}:${index}` } } } };
  });
}

function nextDate(date: string) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function dayCode(day: number) { return ['SU','MO','TU','WE','TH','FR','SA'][day] || 'MO'; }
function firstOccurrence(start: string, days: number[]) { const d = new Date(`${start}T12:00:00Z`); for (let i = 0; i < 7; i++) { if (days.includes(d.getUTCDay())) return d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); } return start; }

async function listAll(tokens: TokenPayload, calendarId: string, params: URLSearchParams) {
  const items: any[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams(params);
    if (pageToken) query.set('pageToken', pageToken);
    const data = await googleFetch(tokens, `/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

export async function getGoogleCalendarStatus() {
  const settings = await getSettings([PUBLIC_KEY]);
  const current = settings[PUBLIC_KEY] as PublicConnection | undefined;
  return { configured: googleCalendarConfigured(), connected: Boolean(current?.connected), ...current };
}

export async function disconnectGoogleCalendar() {
  const connection = await getConnection();
  if (connection?.tokens.accessToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.tokens.refreshToken || connection.tokens.accessToken)}`, { method: 'POST' }).catch(() => null);
  await patchSettings({ [PRIVATE_KEY]: null, [PUBLIC_KEY]: { connected: false } });
}

export async function syncGoogleCalendar(options?: { timezone?: string; timeMin?: string; timeMax?: string }) {
  let connection = await getConnection();
  if (!connection) throw new Error('Google Calendar is not connected.');
  connection = await refreshTokens(connection);
  const timezone = options?.timezone || 'America/Chicago';
  const now = new Date();
  const timeMin = options?.timeMin || new Date(now.getFullYear() - 1, 0, 1).toISOString();
  const timeMax = options?.timeMax || new Date(now.getFullYear() + 2, 11, 31).toISOString();
  const [tasks, courses, settings] = await Promise.all([listTasks(), listCourses(), getSettings([EVENTS_KEY])]);
  const storedEvents = Array.isArray(settings[EVENTS_KEY]) ? settings[EVENTS_KEY] as Array<CalendarEvent & Record<string, any>> : [];
  const desired = new Map<string, any>();
  for (const task of tasks.filter(t => t.status !== 'done')) desired.set(`task:${task.id}`, taskEvent(task, timezone));
  for (const event of storedEvents.filter(e => e.source !== 'google')) desired.set(`event:${event.id}`, localEvent(event, timezone));
  for (const course of courses) for (const item of courseEvents(course, timezone)) desired.set(`course:${item.key}`, item.body);

  const managed = await listAll(connection.tokens, connection.calendarId, new URLSearchParams({ showDeleted: 'false', maxResults: '2500', privateExtendedProperty: 'lstManaged=true' }));
  const managedMap = new Map(managed.map((event: any) => [`${event.extendedProperties?.private?.lstSource}:${event.extendedProperties?.private?.lstId}`, event]));
  let created = 0, updated = 0, removed = 0;
  for (const [key, body] of desired) {
    const hash = hashEvent(body);
    body.extendedProperties.private.lstHash = hash;
    const existing = managedMap.get(key);
    if (!existing) {
      await googleFetch(connection.tokens, `/calendars/${encodeURIComponent(connection.calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) });
      created++;
    } else if (existing.extendedProperties?.private?.lstHash !== hash) {
      await googleFetch(connection.tokens, `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: JSON.stringify(body) });
      updated++;
    }
    managedMap.delete(key);
  }
  for (const stale of managedMap.values()) {
    await googleFetch(connection.tokens, `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(stale.id)}`, { method: 'DELETE' });
    removed++;
  }

  const external = await listAll(connection.tokens, connection.calendarId, new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin, timeMax, showDeleted: 'false', maxResults: '2500' }));
  const imported = external.filter((event: any) => event.status !== 'cancelled' && event.extendedProperties?.private?.lstManaged !== 'true').map((event: any) => googleToLocal(event, connection!.calendarId, timezone));
  const localOnly = storedEvents.filter(e => e.source !== 'google');
  await patchSettings({ [EVENTS_KEY]: [...localOnly, ...imported], [PUBLIC_KEY]: { connected: true, calendarId: connection.calendarId, calendarName: connection.calendarName, lastSyncedAt: new Date().toISOString(), lastSyncSummary: { created, updated, removed, imported: imported.length } } });
  return { created, updated, removed, imported: imported.length };
}

function googleToLocal(event: any, calendarId: string, timezone: string): CalendarEvent & Record<string, any> {
  const startDate = event.start?.date || event.start?.dateTime?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const startTime = event.start?.dateTime ? event.start.dateTime.slice(11, 16) : null;
  const endTime = event.end?.dateTime ? event.end.dateTime.slice(11, 16) : null;
  return { id: `google:${calendarId}:${event.id}:${event.originalStartTime?.dateTime || event.originalStartTime?.date || ''}`, title: event.summary || '(Untitled Google event)', description: event.description || null, category: 'personal', date: startDate, startTime, endTime, allDay: Boolean(event.start?.date), recurring: Boolean(event.recurringEventId || event.recurrence), recurrenceRule: event.recurrence?.[0] || null, recurrenceEndDate: null, location: event.location || null, color: null, course: null, createdAt: event.created || new Date().toISOString(), source: 'google', googleEventId: event.id, googleCalendarId: calendarId, googleUpdatedAt: event.updated, timezone };
}
