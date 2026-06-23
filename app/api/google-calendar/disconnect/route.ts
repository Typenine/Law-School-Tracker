import { NextResponse } from 'next/server';
import { disconnectGoogleCalendar } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    await disconnectGoogleCalendar();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to disconnect Google Calendar.' }, { status: 500 });
  }
}
