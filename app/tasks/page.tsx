"use client";
import TaskTable from '@/components/TaskTable';

export default function TasksPage() {
  return (
    <main className="space-y-4">
      <section className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Tasks</h2>
        </div>
        <TaskTable />
      </section>
    </main>
  );
}
