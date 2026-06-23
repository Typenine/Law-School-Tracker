import { NextResponse } from 'next/server';
import { listWritableGoogleCalendars } from '@/lib/googleCalendarSelection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const calendars = await listWritableGoogleCalendars();
    return NextResponse.json({ calendars });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Unable to list Google calendars.' }, { status: 500 });
  }
}
