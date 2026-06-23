"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import ClassWorkflow from "@/components/ClassWorkflow";
import { useCourses } from "@/lib/useCourses";
import { useSemester } from "@/lib/useSemester";
import { useTasks } from "@/lib/useTasks";
import { tasksClient } from "@/lib/tasksClient";
import type { Task } from "@/lib/types";

function dateKey(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function dueLabel(task: Task): string {
  const key = dateKey(task.dueDate);
  const today = addDaysKey(0);
  const tomorrow = addDaysKey(1);
  if (key < today) return "Overdue";
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(task.dueDate));
}

function formatMinutes(minutes?: number | null): string {
  const total = Math.max(0, Math.round(minutes || 0));
  if (!total) return "Estimate not set";
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

function taskScore(task: Task): number {
  const today = addDaysKey(0);
  const due = dateKey(task.dueDate);
  const days = Math.round((new Date(`${due}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  let score = 0;
  if (days < 0) score += 1000 + Math.abs(days) * 25;
  else if (days === 0) score += 800;
  else if (days === 1) score += 500;
  else if (days <= 3) score += 250 - days * 20;
  score += Math.max(0, 6 - (task.priority || 3)) * 10;
  if (task.activity === "practice") score += 20;
  if (task.activity === "outline") score += 15;
  return score;
}

function TaskRow({ task, onRefresh }: { task: Task; onRefresh: () => Promise<void> }) {
  const [working, setWorking] = useState(false);

  async function complete() {
    setWorking(true);
    try {
      await tasksClient.update(task.id, { status: "done", completedAt: new Date().toISOString() }, { silent: true });
      await onRefresh();
    } finally {
      setWorking(false);
    }
  }

  async function moveTomorrow() {
    setWorking(true);
    try {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(23, 59, 59, 999);
      await tasksClient.update(task.id, { dueDate: d.toISOString() }, { silent: true });
      await onRefresh();
    } finally {
      setWorking(false);
    }
  }

  const overdue = dateKey(task.dueDate) < addDaysKey(0);

  return (
    <article className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {task.course ? <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-300">{task.course}</span> : null}
            <span className={`rounded-full px-2.5 py-1 font-medium ${overdue ? "bg-rose-500/15 text-rose-300" : "bg-slate-700/70 text-slate-200"}`}>{dueLabel(task)}</span>
            {task.activity ? <span className="capitalize text-slate-400">{task.activity}</span> : null}
          </div>
          <h3 className="text-base font-semibold text-slate-100">{task.title}</h3>
          <p className="mt-1 text-sm text-slate-400">{formatMinutes(task.estimatedMinutes)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button disabled={working} onClick={moveTomorrow} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Tomorrow</button>
          <button disabled={working} onClick={complete} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">Complete</button>
        </div>
      </div>
    </article>
  );
}

export default function TodayPage() {
  const { tasks, loading, error, refresh } = useTasks();
  const { courses } = useCourses();
  const { currentTerm, showAllTerms, activeSemester, loading: semesterLoading } = useSemester();
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [dueDate, setDueDate] = useState(addDaysKey(0));
  const [adding, setAdding] = useState(false);

  const activeCourses = useMemo(() => {
    if (!activeSemester) return courses;
    return courses.filter((item) => item.semester === activeSemester.season && item.year === activeSemester.year);
  }, [courses, activeSemester]);

  const activeTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status !== "done")
      .filter((task) => showAllTerms || !currentTerm || task.term === currentTerm)
      .sort((a, b) => taskScore(b) - taskScore(a));
  }, [tasks, currentTerm, showAllTerms]);

  const recommended = activeTasks.slice(0, 5);
  const todayKey = addDaysKey(0);
  const weekEnd = addDaysKey(7);
  const overdueCount = activeTasks.filter((task) => dateKey(task.dueDate) < todayKey).length;
  const dueTodayCount = activeTasks.filter((task) => dateKey(task.dueDate) === todayKey).length;
  const dueSoon = activeTasks.filter((task) => dateKey(task.dueDate) >= todayKey && dateKey(task.dueDate) <= weekEnd);
  const plannedMinutes = recommended.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);

  const courseStatuses = useMemo(() => {
    const names = Array.from(new Set([
      ...activeCourses.map((item) => item.title),
      ...activeTasks.map((task) => task.course || "").filter(Boolean),
    ]));

    return names.map((name) => {
      const open = activeTasks.filter((task) => (task.course || "").toLowerCase() === name.toLowerCase());
      const urgent = open.filter((task) => dateKey(task.dueDate) <= addDaysKey(3));
      const hasOutline = open.some((task) => task.activity === "outline" || /outline/i.test(task.title));
      let status = "On track";
      let tone = "text-emerald-300 bg-emerald-500/10";
      if (urgent.some((task) => dateKey(task.dueDate) < todayKey)) {
        status = "Behind";
        tone = "text-rose-300 bg-rose-500/10";
      } else if (urgent.length) {
        status = "Work due soon";
        tone = "text-amber-300 bg-amber-500/10";
      } else if (!hasOutline && open.length) {
        status = "Outline check needed";
        tone = "text-sky-300 bg-sky-500/10";
      }
      return { name, open: open.length, status, tone };
    }).filter((item) => item.open > 0 || activeCourses.some((courseItem) => courseItem.title === item.name)).slice(0, 6);
  }, [activeCourses, activeTasks, todayKey]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !dueDate || !currentTerm) return;
    setAdding(true);
    try {
      const due = new Date(`${dueDate}T23:59:59`);
      await tasksClient.create({
        title: title.trim(),
        course: course || null,
        dueDate: due.toISOString(),
        status: "todo",
        term: currentTerm,
      }, { silent: true });
      setTitle("");
      await refresh();
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-5 shadow-lg sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-emerald-300">Your law school command center</p>
              {activeSemester ? <Link href="/semester" className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:text-white">{activeSemester.name}</Link> : null}
            </div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-100">What needs your attention today</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Prepare for class, open the right document, or start the highest-value task without rebuilding a schedule.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/recovery" className="rounded-lg border border-rose-500/50 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/10">I’m behind</Link>
              <Link href="/wizard" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Import syllabus</Link>
              <Link href="/review" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Weekly review</Link>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-800/70 px-4 py-3"><div className="text-xl font-semibold text-rose-300">{overdueCount}</div><div className="text-xs text-slate-400">Overdue</div></div>
            <div className="rounded-xl bg-slate-800/70 px-4 py-3"><div className="text-xl font-semibold text-amber-300">{dueTodayCount}</div><div className="text-xs text-slate-400">Due today</div></div>
            <div className="rounded-xl bg-slate-800/70 px-4 py-3"><div className="text-xl font-semibold text-emerald-300">{formatMinutes(plannedMinutes).replace("Estimate not set", "0 min")}</div><div className="text-xs text-slate-400">Top workload</div></div>
          </div>
        </div>
      </section>

      {!semesterLoading && !activeSemester ? (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="font-semibold text-amber-200">Set an active semester before adding work</h2>
          <p className="mt-1 text-sm text-amber-100/70">This keeps old coursework out of the current dashboard.</p>
          <Link href="/semester" className="mt-3 inline-flex rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950">Open Term Setup</Link>
        </section>
      ) : null}

      <ClassWorkflow courses={activeCourses} tasks={tasks} currentTerm={currentTerm} activeSemester={activeSemester} />

      <form onSubmit={addTask} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-100">Quick add</h2>
            {activeSemester ? <p className="text-xs text-slate-500">New work is saved to {activeSemester.name}.</p> : null}
          </div>
          <Link href="/tasks" className="text-sm text-emerald-300 hover:text-emerald-200">Open all tasks</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_170px_auto]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400" />
          <select value={course} onChange={(e) => setCourse(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-400">
            <option value="">No course</option>
            {activeCourses.map((item) => <option key={item.id} value={item.title}>{item.title}</option>)}
          </select>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-400" />
          <button disabled={adding || !title.trim() || !currentTerm} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">Add task</button>
        </div>
      </form>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Recommended next</h2>
              <p className="text-sm text-slate-400">Up to five tasks, ranked automatically.</p>
            </div>
            <Link href="/calendar" className="text-sm text-slate-300 hover:text-white">View calendar</Link>
          </div>

          {loading ? <div className="rounded-xl border border-slate-700 p-6 text-sm text-slate-400">Loading your work…</div> : null}
          {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
          {!loading && !error && recommended.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-600 p-8 text-center">
              <p className="font-medium text-slate-200">Nothing currently needs attention.</p>
              <p className="mt-1 text-sm text-slate-400">Add your Fall 2026 courses, then import the first readings and assignments.</p>
              <div className="mt-3 flex justify-center gap-2"><Link href="/courses" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Set up courses</Link><Link href="/wizard" className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Import syllabus</Link></div>
            </div>
          ) : null}
          {recommended.map((task) => <TaskRow key={task.id} task={task} onRefresh={refresh} />)}
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-100">Coming up</h2>
                <p className="text-sm text-slate-400">Next seven days</p>
              </div>
              <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{dueSoon.length} tasks</span>
            </div>
            <div className="space-y-2">
              {dueSoon.slice(0, 6).map((task) => (
                <div key={task.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-950/45 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">{task.course || "General"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{dueLabel(task)}</span>
                </div>
              ))}
              {!dueSoon.length ? <p className="py-4 text-center text-sm text-slate-500">No deadlines in the next seven days.</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-100">Course status</h2>
                <p className="text-sm text-slate-400">Current semester only</p>
              </div>
              <Link href="/courses" className="text-sm text-emerald-300 hover:text-emerald-200">Courses</Link>
            </div>
            <div className="space-y-2">
              {courseStatuses.map((item) => (
                <div key={item.name} className="rounded-lg bg-slate-950/45 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium text-slate-200">{item.name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${item.tone}`}>{item.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{item.open} open task{item.open === 1 ? "" : "s"}</p>
                </div>
              ))}
              {!courseStatuses.length ? <p className="py-4 text-center text-sm text-slate-500">No courses are set up for {activeSemester?.name || "the active semester"}.</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
