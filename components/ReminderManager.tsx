"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import type { TrackerNotification } from '@/lib/notificationStore';

export default function ReminderManager() {
  const [notifications, setNotifications] = useState<TrackerNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const unread = useMemo(() => notifications.filter(item => !item.readAt).length, [notifications]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ notifications: TrackerNotification[] }>('/api/notifications');
      setNotifications(data.notifications || []);
    } catch {
      // Keep the last successfully loaded inbox visible.
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async (id: string, action: 'read' | 'dismiss' | 'browser-shown') => {
    try {
      await apiFetch('/api/notifications', { method: 'PATCH', body: { id, action } });
      setNotifications(current => action === 'dismiss'
        ? current.filter(item => item.id !== id)
        : current.map(item => item.id === id ? {
            ...item,
            ...(action === 'read' ? { readAt: new Date().toISOString() } : { browserShownAt: new Date().toISOString() }),
          } : item));
    } catch {}
  }, []);

  const showBrowserNotifications = useCallback(async (items: TrackerNotification[]) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
    const unseen = items.filter(item => !item.browserShownAt && !item.dismissedAt).slice(0, 5);
    if (!unseen.length) return;
    try {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
      for (const item of unseen) {
        if (registration) {
          await registration.showNotification(item.title, {
            body: item.body,
            tag: item.id,
            data: { url: item.href || '/' },
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
          });
        } else {
          new Notification(item.title, { body: item.body, tag: item.id });
        }
        await update(item.id, 'browser-shown');
      }
    } catch {}
  }, [update]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => { void showBrowserNotifications(notifications); }, [notifications, showBrowserNotifications]);

  return <div className="fixed bottom-4 right-4 z-50">
    <button onClick={() => setOpen(value => !value)} className="relative rounded-full border border-slate-600 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-100 shadow-xl hover:bg-slate-900" aria-label="Open notifications">
      Reminders
      {unread ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] text-white">{unread > 99 ? '99+' : unread}</span> : null}
    </button>
    {open ? <section className="absolute bottom-14 right-0 w-[min(92vw,24rem)] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div><h2 className="font-semibold text-slate-100">Reminders</h2><p className="text-xs text-slate-500">{unread} unread</p></div><button onClick={() => setOpen(false)} className="text-sm text-slate-400">Close</button></div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
        {loading ? <p className="p-3 text-sm text-slate-500">Loading reminders…</p> : null}
        {!loading && !notifications.length ? <p className="p-3 text-sm text-slate-500">No current reminders.</p> : null}
        {notifications.map(item => <article key={item.id} className={`rounded-lg border p-3 ${item.readAt ? 'border-slate-800 bg-slate-900/35' : 'border-sky-500/30 bg-sky-500/5'}`}>
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-100">{item.title}</p><p className="mt-1 text-xs text-slate-400">{item.body}</p></div><button onClick={() => void update(item.id, 'dismiss')} className="text-xs text-slate-500 hover:text-rose-300">Dismiss</button></div>
          <div className="mt-3 flex items-center gap-3">{item.href ? <Link href={item.href} onClick={() => { void update(item.id, 'read'); setOpen(false); }} className="text-xs font-medium text-sky-300">Open</Link> : null}{!item.readAt ? <button onClick={() => void update(item.id, 'read')} className="text-xs text-slate-400">Mark read</button> : null}<span className="ml-auto text-[11px] text-slate-600">{new Date(item.createdAt).toLocaleString()}</span></div>
        </article>)}
      </div>
    </section> : null}
  </div>;
}
