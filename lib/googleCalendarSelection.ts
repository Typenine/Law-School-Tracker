import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getSettings, patchSettings } from './storage';

const PRIVATE_KEY = 'googleCalendarPrivateV1';
const PUBLIC_KEY = 'googleCalendarPublicV1';

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

export interface WritableGoogleCalendar {
  id: string;
  name: string;
  primary: boolean;
  accessRole: string;
  selected: boolean;
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

async function connection() {
  const settings = await getSettings([PRIVATE_KEY, PUBLIC_KEY]);
  if (!settings[PRIVATE_KEY]) throw new Error('Google Calendar is not connected.');
  return { privateConnection: decrypt<PrivateConnection>(settings[PRIVATE_KEY]), publicConnection: settings[PUBLIC_KEY] || {} };
}

async function refresh(current: PrivateConnection) {
  if (current.tokens.expiresAt && current.tokens.expiresAt > Date.now() + 60_000) return current;
  if (!current.tokens.refreshToken) throw new Error('Google Calendar needs to be reconnected.');
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: current.tokens.refreshToken, grant_type: 'refresh_token' }),
  });
  if (!response.ok) throw new Error('Google Calendar access could not be refreshed.');
  const data = await response.json();
  const next = { ...current, tokens: { ...current.tokens, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, scope: data.scope || current.tokens.scope } };
  await patchSettings({ [PRIVATE_KEY]: encrypt(next) });
  return next;
}

async function calendarList(tokens: TokenPayload) {
  const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  if (!response.ok) throw new Error(`Unable to list Google calendars: ${response.status}`);
  return response.json();
}

export async function listWritableGoogleCalendars(): Promise<WritableGoogleCalendar[]> {
  const state = await connection();
  const current = await refresh(state.privateConnection);
  const data = await calendarList(current.tokens);
  return (data.items || []).map((item: any): WritableGoogleCalendar => ({
    id: item.id,
    name: item.summary || item.id,
    primary: Boolean(item.primary),
    accessRole: item.accessRole,
    selected: item.id === current.calendarId,
  }));
}

export async function selectGoogleCalendar(calendarId: string) {
  const state = await connection();
  const current = await refresh(state.privateConnection);
  const calendars: WritableGoogleCalendar[] = await listWritableGoogleCalendars();
  const selected = calendars.find((item: WritableGoogleCalendar) => item.id === calendarId);
  if (!selected) throw new Error('Select a calendar where you have permission to create and update events.');
  const next: PrivateConnection = { ...current, calendarId: selected.id, calendarName: selected.name };
  await patchSettings({
    [PRIVATE_KEY]: encrypt(next),
    [PUBLIC_KEY]: { ...state.publicConnection, connected: true, calendarId: selected.id, calendarName: selected.name },
  });
  return { calendarId: selected.id, calendarName: selected.name };
}
