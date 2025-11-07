export const dynamic = 'force-dynamic';

export default function HelpPage() {
  return (
    <main className="space-y-6">
      <section className="card p-5">
        <h2 className="text-xl font-semibold mb-2">Welcome to Law School Tracker</h2>
        <p className="text-slate-300/80">This guide explains how to manage tasks, plan your week, log study time, and export to your calendar.</p>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Inbox (Tasks) & CSV Import</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><b>Inbox Quick Add</b>: On the <b>Tasks</b> page, use <b>Quick Add (Inbox)</b> to capture items in one line. Example: <i>T&amp;E: Read 599–622 (24p) – due Fri</i>. Estimation uses your historical pace with a fallback minutes/page from Settings.</li>
          <li><b>Import Backlog</b>: If you used the legacy Backlog intake, click <b>Import Backlog</b> on the Tasks toolbar to migrate local items into Tasks (tagged <code>inbox</code>).</li>
          <li><b>CSV Import (sessions)</b>: Open <b>Settings → Import Data (CSV)</b> to import study sessions with mapping, preview, deduplication, and replace/append modes.</li>
        </ul>
        <p className="text-xs text-slate-300/70">Tip: Minutes/page (fallback) and default focus can be set in Settings.</p>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Manage tasks</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><b>Quick Add (Inbox)</b>: Type <i>Course: Title (24p) – due Fri</i> and press <b>Add</b>. Due dates are date-only; time is normalized to end-of-day.</li>
          <li><b>Inline edit</b>: Click <b>Edit</b> to change title/course/due/estimate; <b>Save</b> when done.</li>
          <li><b>Filters</b>: Filter by status, course substring, and tag. Use the <b>Inbox</b> button to toggle <code>tag=inbox</code>.</li>
          <li><b>Bulk actions</b>: Select rows to reveal bulk actions (Mark done/todo, Delete, set Due date, set Course, Add/Remove tag, Change Priority, Clear Inbox tag).</li>
          <li><b>Mark done</b> or <b>Delete</b> from the Actions column.</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Planner (next 7 days)</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Open <b>Planner</b> from the top nav.</li>
          <li><b>Drag and drop</b> tasks between days to reschedule the due date. Changes save instantly.</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Log study time</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><b>Focus Timer</b>: Start/Pause/Resume a timer; optionally select a task and focus (1–10); <b>Save</b> to create a session.</li>
          <li>Pomodoro mode offers presets (25/5 and 50/10) with automatic work/break switching.</li>
          <li><b>Session Logger</b>: Manually log minutes, focus, notes.</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Stats & goals</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><b>Weekly goal</b>: Set weekly hours and track progress.</li>
          <li><b>Burndown</b>: See estimated vs. logged minutes and remaining time for the week.</li>
          <li><b>Per-course breakdown</b>: Identify which courses need attention.</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Export to calendar (ICS)</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Use the <b>Download .ics</b> button or visit <code>/api/export/ics</code>.</li>
          <li><b>Filters</b>: <code>?course=Contracts</code>, <code>?status=todo</code>.</li>
          <li><b>Timed events</b>: <code>?timed=1</code> creates timed blocks starting 09:00 using <code>estimatedMinutes</code> (long items chunked).</li>
          <li><b>Private token</b> (optional): set <code>ICS_PRIVATE_TOKEN</code> and append <code>?token=YOUR_TOKEN</code>.</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Settings & reminders</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Open <b>Settings</b> to configure minutes/page, default focus, reminders (lead hours), per-course overrides, and ICS token.</li>
          <li>In-app <b>reminders</b> show upcoming tasks; enable them and set the lead time in Settings.</li>
        </ul>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Data & deployment</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><b>Local</b>: data stored in <code>data/db.json</code>.</li>
          <li><b>Vercel</b>: set <code>DATABASE_URL</code> (Postgres) for persistence; JSON fallback writes to <code>/tmp</code>.</li>
        </ul>
      </section>

      <section className="card p-5">
        <h3 className="text-lg font-medium mb-2">Troubleshooting</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>ICS requires <code>?token=...</code> if <code>ICS_PRIVATE_TOKEN</code> is set.</li>
          <li>On Vercel, ensure <code>DATABASE_URL</code> is configured for durable storage.</li>
          <li>For parser misses, use Preview to fix before saving; you can edit inline later as well.</li>
        </ul>
      </section>
    </main>
  );
}
