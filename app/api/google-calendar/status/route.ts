import { NextResponse } from 'next/server';
import { getGoogleCalendarStatus } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await getGoogleCalendarStatus());
  } catch (cause: any) {
    return NextResponse.json({ configured: false, connected: false, error: cause?.message || 'Unable to read Google Calendar status.' }, { status: 500 });
  }
}
