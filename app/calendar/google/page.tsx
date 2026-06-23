import Link from 'next/link';
import GoogleCalendarPanel from '@/components/GoogleCalendarPanel';

export default function GoogleCalendarPage() {
  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <Link href="/calendar" className="text-sm text-slate-400">Back to weekly agenda</Link>
        <p className="mt-4 text-sm font-medium text-sky-300">Calendar integration</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Connect the tracker to Google Calendar</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Sync is manual so changes are reviewable and the tracker never modifies unrelated Google events.</p>
      </section>
      <GoogleCalendarPanel />
      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5 text-sm text-slate-400">
        <h2 className="font-semibold text-slate-100">What sync includes</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="font-medium text-slate-200">Tracker to Google</p><p className="mt-1">Open assignments, exams, recurring course meetings, and commitments created in the tracker.</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="font-medium text-slate-200">Google to tracker</p><p className="mt-1">Events created outside the tracker appear in the weekly agenda after the next sync.</p></div>
        </div>
      </section>
    </main>
  );
}
