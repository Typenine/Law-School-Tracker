
"use client";
import Link from 'next/link';
import TaskTable from '@/components/TaskTable';

export default function TasksPage() {
  return (
    <main className="space-y-4">
      <section className="card p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-medium">Tasks</h2><p className="text-xs text-slate-400">Assignments, readings, deadlines, and logged progress.</p></div>
          <Link href="/reading" className="px-3 py-2 rounded border border-white/10 text-sm">Reading tracker</Link>
        </div>
        <TaskTable />
      </section>
    </main>
  );
}
