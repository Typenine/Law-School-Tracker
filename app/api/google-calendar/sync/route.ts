import { NextRequest, NextResponse } from 'next/server';
import { syncGoogleCalendar } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const timezone = typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'UTC';
    const result = await syncGoogleCalendar({ timezone, timeMin: body.timeMin, timeMax: body.timeMax });
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Calendar sync failed.' }, { status: 500 });
  }
}
