import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');
  const expected = req.cookies.get('google_calendar_oauth_state')?.value;
  const redirect = new URL('/settings', req.nextUrl.origin);

  if (error) {
    redirect.searchParams.set('calendar', 'denied');
    return NextResponse.redirect(redirect);
  }
  if (!code || !state || !expected || state !== expected) {
    redirect.searchParams.set('calendar', 'invalid_state');
    return NextResponse.redirect(redirect);
  }

  try {
    const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${req.nextUrl.origin}/api/google-calendar/callback`;
    await exchangeCode(code, redirectUri);
    redirect.searchParams.set('calendar', 'connected');
  } catch (cause: any) {
    console.error('Google Calendar OAuth callback failed:', cause?.message || cause);
    redirect.searchParams.set('calendar', 'error');
  }

  const response = NextResponse.redirect(redirect);
  response.cookies.set('google_calendar_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
