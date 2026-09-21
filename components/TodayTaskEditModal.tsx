"use client";

import { useEffect, useMemo, useState } from "react";
import type { Course, Task } from "@/lib/types";
import { apiFetch } from "@/lib/apiClient";
import { countPages, extractPageRangesFromTitle, formatPageRanges, parsePageRanges } from "@/lib/pageRanges";

type Props = {
  task: Task | null;
  courses: Course[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizedRanges(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return formatPageRanges(parsePageRanges(trimmed));
  } catch {
    return trimmed;
  }
}

function taskPageRanges(task: Task | null): string {
  if (!task) return "";
  return task.originalPageRanges || extractPageRangesFromTitle(task.title) || "";
}

function courseKey(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

export default function TodayTaskEditModal({ task, courses, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [activity, setActivity] = useState("");
  const [pageRanges, setPageRanges] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title || "");
    setCourse(task.course || "");
    setActivity(task.activity || "");
    setPageRanges(taskPageRanges(task));
    setEstimatedMinutes(task.estimatedMinutes == null ? "" : String(task.estimatedMinutes));
    setDueDate(isoToLocalInput(task.dueDate));
    setPriority(task.priority == null ? "" : String(task.priority));
    setNotes(task.notes || "");
    setError("");
  }, [task]);

  const pageCount = useMemo(() => {
    if (!pageRanges.trim()) return 0;
    try {
      return countPages(parsePageRanges(pageRanges));
    } catch {
      return 0;
    }
  }, [pageRanges]);

  if (!task) return null;

  async function save() {
    if (!task) return;
    const currentTask = task;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Title is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const initialRanges = normalizedRanges(taskPageRanges(currentTask));
      const nextRanges = normalizedRanges(pageRanges);
      const rangesChanged = initialRanges !== nextRanges;

      let nextTitle = cleanTitle;
      if (rangesChanged) {
        nextTitle = nextTitle.replace(/\s*\b(?:pp?|pages?)\.?\s*[0-9,\s–—-]+/gi, "").trim();
        if (nextRanges) nextTitle = `${nextTitle} p. ${nextRanges}`;
      }

      const matchedCourse = courses.find(item => courseKey(item.title) === courseKey(course));
      const estimate = estimatedMinutes.trim() === "" ? null : Math.max(0, Math.round(Number(estimatedMinutes)));
      const priorityValue = priority.trim() === "" ? null : Math.max(1, Math.min(5, Math.round(Number(priority))));

      if (estimatedMinutes.trim() !== "" && (estimate == null || !Number.isFinite(estimate))) {
        setError("Estimated minutes must be a number.");
        setSaving(false);
        return;
      }
      if (priority.trim() !== "" && (priorityValue == null || !Number.isFinite(priorityValue))) {
        setError("Priority must be a number from 1 to 5.");
        setSaving(false);
        return;
      }

      const body: Record<string, unknown> = {
        title: nextTitle,
        course: course.trim() || null,
        courseId: matchedCourse?.id || null,
        activity: activity || null,
        estimatedMinutes: estimate,
        priority: priorityValue,
        notes: notes.trim() || null,
      };

      if (dueDate) body.dueDate = new Date(dueDate).toISOString();
      if (rangesChanged) {
        body.originalPageRanges = nextRanges || null;
        body.remainingPageRanges = nextRanges || null;
        body.pagesRead = nextRanges ? pageCount : null;
      }

      await apiFetch(`/api/tasks/${currentTask.id}`, { method: "PATCH", body });
      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Unable to save the task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[#29405f] bg-[#0e1c2f] shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#203451] px-5 py-4">
          <h2 className="text-base font-semibold text-white">Edit task</h2>
          <button className="rounded px-2 py-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={onClose} aria-label="Close edit task">×</button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Title</label>
            <input value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Course</label>
              <input list="today-task-course-options" value={course} onChange={event => setCourse(event.target.value)} className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
              <datalist id="today-task-course-options">
                {courses.map(item => <option key={item.id} value={item.title} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Activity</label>
              <select value={activity} onChange={event => setActivity(event.target.value)} className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]">
                <option value="">Assignment</option>
                <option value="reading">Reading</option>
                <option value="outline">Outline</option>
                <option value="review">Review</option>
                <option value="practice">Practice</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Page ranges</label>
            <input value={pageRanges} onChange={event => setPageRanges(event.target.value)} placeholder="e.g. 241-250, 260-265" className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
            {pageCount > 0 ? <div className="mt-1 text-xs text-slate-500">{pageCount} pages</div> : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Estimate</label>
              <input type="number" min={0} step={5} value={estimatedMinutes} onChange={event => setEstimatedMinutes(event.target.value)} className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Due</label>
              <input type="datetime-local" value={dueDate} onChange={event => setDueDate(event.target.value)} className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Priority</label>
            <input type="number" min={1} max={5} value={priority} onChange={event => setPriority(event.target.value)} className="w-full rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Notes</label>
            <textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} className="w-full resize-none rounded-lg border border-[#29405f] bg-[#081426] px-3 py-2 text-sm text-white outline-none focus:border-[#4e9ee8]" />
          </div>

          {error ? <div className="text-sm text-rose-300">{error}</div> : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-[#203451] px-5 py-4">
          <button className="rounded-lg border border-[#29405f] px-4 py-2 text-sm text-slate-200 hover:bg-white/5" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="rounded-lg bg-[#4e9ee8] px-4 py-2 text-sm font-medium text-[#06152b] hover:bg-[#6bb0ec] disabled:opacity-60" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
