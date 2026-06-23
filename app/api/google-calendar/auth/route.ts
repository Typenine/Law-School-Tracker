import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildGoogleAuthUrl, googleCalendarConfigured } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!googleCalendarConfigured()) {
    return NextResponse.json({ error: 'Google Calendar environment variables are not configured.' }, { status: 503 });
  }
  const state = randomBytes(24).toString('hex');
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${req.nextUrl.origin}/api/google-calendar/callback`;
  const response = NextResponse.redirect(buildGoogleAuthUrl(redirectUri, state));
  response.cookies.set('google_calendar_oauth_state', state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
