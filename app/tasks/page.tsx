"use client";
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TaskTable from '@/components/TaskTable';

function TasksInner() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    if (!search?.get('status')) {
      router.replace('/tasks?status=done');
    }
  }, [search, router]);
  return (
    <section className="card p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Tasks</h2>
        <div className="flex items-center gap-2 text-xs text-slate-300/70">
          <a href="/tasks?status=done" className="px-2 py-1 rounded border border-[#1b2344]">Show Done</a>
          <a href="/tasks?status=todo" className="px-2 py-1 rounded border border-[#1b2344]">Show Todo</a>
        </div>
      </div>
      <TaskTable />
    </section>
  );
}

export default function TasksPage() {
  return (
    <main className="space-y-4">
      <Suspense fallback={null}>
        <TasksInner />
      </Suspense>
    </main>
  );
}
