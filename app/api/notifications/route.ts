import { NextRequest, NextResponse } from 'next/server';
import {
  generateTaskNotifications,
  listNotifications,
  updateNotification,
} from '@/lib/notificationStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('generate') !== 'false') await generateTaskNotifications();
    const includeDismissed = req.nextUrl.searchParams.get('includeDismissed') === 'true';
    const notifications = await listNotifications(includeDismissed);
    return NextResponse.json({ notifications, unread: notifications.filter(item => !item.readAt).length });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Notifications could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const now = new Date().toISOString();
    const patch = body.action === 'dismiss'
      ? { dismissedAt: now, readAt: now }
      : body.action === 'browser-shown'
        ? { browserShownAt: now }
        : { readAt: now };
    const notification = await updateNotification(id, patch);
    return notification
      ? NextResponse.json({ notification })
      : NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Notification could not be updated.' }, { status: 500 });
  }
}
