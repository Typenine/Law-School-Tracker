export const dynamic = 'force-dynamic';

export default function HelpPage() {
  return (
    <main className="space-y-6">
      <section className="card p-5">
        <h2 className="text-xl font-semibold mb-2">Welcome to Law School Tracker</h2>
        <p className="text-slate-300/80">This guide explains how to upload syllabi, manage tasks, log study time, and export to your calendar.</p>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Upload a syllabus</h3>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Go to the home page and find the <b>Upload Syllabus</b> card.</li>
          <li>Optionally enter a Course name and Minutes per page. You can enable <b>Preview before saving</b> to review parsed items.</li>
          <li>Select a PDF/DOCX/TXT file and click <b>Upload & Parse</b>.</li>
          <li>If preview is enabled, a review table appears. Edit, uncheck unwanted items, and click <b>Save All</b>.</li>
        </ol>
        <p className="text-xs text-slate-300/70">Tip: Minutes/page and course-specific defaults are remembered in Settings.</p>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Manage tasks</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><b>Quick add</b>: Title, Course (optional), Due, and Est. minutes; press <b>Add Task</b>.</li>
          <li><b>Inline edit</b>: Click <b>Edit</b> to change title/course/due/estimate; <b>Save</b> when done.</li>
          <li><b>Filters</b>: Filter by status and course substring.</li>
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
