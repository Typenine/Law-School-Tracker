import Link from 'next/link';

const setup = [
  ['Choose Fall 2026', '/semester', 'Confirm the active semester and its broad date range.'],
  ['Add courses', '/courses', 'Enter each course, meeting times, instructor, and room.'],
  ['Connect Google Drive', '/courses', 'Link the course folder, notes, syllabus, outline, and assignments folder.'],
  ['Import syllabi', '/wizard', 'Review extracted readings and deadlines before saving them.'],
  ['Add exam dates', '/exam', 'Record the date and format for every exam.'],
  ['Build the first week', '/week-plan', 'Enter available time and accept or adjust the proposed plan.'],
] as const;

export default function HelpPage() {
  return <main className="space-y-6">
    <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <p className="text-sm font-medium text-sky-300">Setup and workflow guide</p>
      <h2 className="mt-1 text-2xl font-semibold text-slate-100">Use the tracker at moments you already have</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">Google Drive remains the source of truth for course material. The tracker organizes what matters, opens the right document, and keeps the semester from drifting.</p>
    </section>

    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
      <h2 className="text-lg font-semibold text-slate-100">Fall 2026 setup</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{setup.map(([title, href, description], index) => <Link key={title} href={href} className="rounded-xl border border-slate-700 bg-slate-950/35 p-4 hover:bg-slate-800"><div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-sm font-semibold text-slate-950">{index + 1}</span><div><h3 className="font-medium text-slate-200">{title}</h3><p className="mt-1 text-sm text-slate-500">{description}</p></div></div></Link>)}</div>
    </section>

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <h2 className="font-semibold text-slate-100">Normal day</h2>
        <div className="mt-4 space-y-4 text-sm text-slate-400">
          <div><p className="font-medium text-slate-200">Morning</p><p>Open Today. Use the recommended list and upcoming class cards. Do not manually build a daily schedule.</p></div>
          <div><p className="font-medium text-slate-200">Before class</p><p>Open the course notes, syllabus, or reading from the class card and mark the class prepared.</p></div>
          <div><p className="font-medium text-slate-200">While working</p><p>Use Start Work from Tasks. Save partial progress or finish the task so Study History updates automatically.</p></div>
          <div><p className="font-medium text-slate-200">After class</p><p>Use the course workspace to capture one doctrine, case, or question that needs outline follow-up.</p></div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <h2 className="font-semibold text-slate-100">Sunday review</h2>
        <div className="mt-4 space-y-4 text-sm text-slate-400">
          <div><p className="font-medium text-slate-200">1. Close unfinished work</p><p>Complete, move, or send overdue work to Recovery Mode.</p></div>
          <div><p className="font-medium text-slate-200">2. Maintain courses</p><p>Review missing class captures, Drive links, and outline follow-ups.</p></div>
          <div><p className="font-medium text-slate-200">3. Look ahead</p><p>Review next week’s deadlines and build a weekly plan only when it adds value.</p></div>
          <Link href="/review" className="inline-flex rounded-lg bg-sky-500 px-3 py-2 font-semibold text-slate-950">Open Weekly Review</Link>
        </div>
      </section>

      <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
        <h2 className="font-semibold text-rose-200">When you are behind</h2>
        <p className="mt-2 text-sm text-slate-400">Do not manually reschedule everything. Recovery Mode classifies work into must complete, skim, defer, and drop, then builds a plan for the time actually available.</p>
        <Link href="/recovery" className="mt-4 inline-flex rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white">Open Recovery Mode</Link>
      </section>

      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h2 className="font-semibold text-amber-200">Exam period</h2>
        <p className="mt-2 text-sm text-slate-400">Exam Prep shifts attention from readings to attack outlines, issue checklists, weak rules, case analogies, and timed essays.</p>
        <Link href="/exam" className="mt-4 inline-flex rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950">Open Exam Prep</Link>
      </section>
    </div>

    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
      <h2 className="font-semibold text-slate-100">Spring 2027 rollover</h2>
      <p className="mt-2 text-sm text-slate-400">Open Term Setup after Fall 2026 ends. Create Spring 2027, carry forward weekly availability, and leave Fall courses, completed work, and study history archived. New course schedules and syllabi should not be copied.</p>
      <Link href="/semester" className="mt-4 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Open Term Setup</Link>
    </section>
  </main>;
}
