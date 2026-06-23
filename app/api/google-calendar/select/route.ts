import { NextRequest, NextResponse } from 'next/server';
import { selectGoogleCalendar } from '@/lib/googleCalendarSelection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.calendarId) return NextResponse.json({ error: 'calendarId is required' }, { status: 400 });
    return NextResponse.json(await selectGoogleCalendar(String(body.calendarId)));
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Unable to select Google calendar.' }, { status: 500 });
  }
}
