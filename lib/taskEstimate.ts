"use client";

import type { Task } from "@/lib/types";

export type TaskEstimateResult = { minutes: number; guessed: boolean };

type CourseMppEntry = {
  mpp: number;
  sample?: number;
  updatedAt?: string;
  overrideEnabled?: boolean;
  overrideMpp?: number | null;
};

function baseMpp(): number {
  if (typeof window === "undefined") return 2;
  try {
    const s = window.localStorage.getItem("minutesPerPage");
    const n = s ? parseFloat(s) : NaN;
    return !isNaN(n) && n > 0 ? n : 2;
  } catch {
    return 2;
  }
}

function getCourseMpp(course?: string | null): number {
  const fallback = baseMpp();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem("courseMppMap") || "{}";
    const map = JSON.parse(raw) as Record<string, CourseMppEntry>;
    const key = (course || "").toString().trim().toLowerCase();
    const entry = map[key];
    if (!entry || typeof entry.mpp !== "number" || entry.mpp <= 0) return fallback;
    if (entry.overrideEnabled && typeof entry.overrideMpp === "number" && entry.overrideMpp > 0) {
      return Math.max(0.5, Math.min(6, entry.overrideMpp));
    }
    return Math.max(0.5, Math.min(6, entry.mpp));
  } catch {
    return fallback;
  }
}

// Flexible item type that works with both Task (pagesRead) and BacklogItem (pages)
type EstimableItem = {
  estimatedMinutes?: number | null;
  pagesRead?: number | null;
  pages?: number | null;
  course?: string | null;
};

export function estimateMinutesForTask(t: EstimableItem): TaskEstimateResult {
  // 1) Explicit estimate wins
  const est = Math.max(0, Math.round(Number(t.estimatedMinutes) || 0));
  if (est > 0) return { minutes: est, guessed: false };

  // 2) Pages-based with learned MPP preferred, +10m overhead
  // Support both pagesRead (Task) and pages (BacklogItem)
  const pages = Math.max(0, Number(t.pagesRead) || Number(t.pages) || 0);
  if (pages > 0) {
    const mpp = getCourseMpp(t.course || "");
    const minutes = Math.round(pages * mpp + 10);
    return { minutes, guessed: false };
  }

  // 3) Fallback default
  return { minutes: 30, guessed: true };
}
