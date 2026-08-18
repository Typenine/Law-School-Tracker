"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/lib/types";
import { onTasksChanged } from "@/lib/taskBus";

export type SurfaceTask = Task & {
  workflowState?: 'not-started' | 'in-progress' | 'done' | 'canceled';
  displayState?: 'not-started' | 'in-progress' | 'done' | 'canceled' | 'blocked';
  blocked?: boolean;
  blockedBy?: Array<{ id: string; title: string }>;
  atRisk?: boolean;
  atRiskReason?: string | null;
  loggedMinutes?: number;
  remainingMinutes?: number;
  percentComplete?: number;
  checklistPercent?: number;
  scheduledMinutes?: number;
};

/**
 * Shared task reads come from Task v2.1 so Today, Calendar, Courses, Week Plan,
 * Search and Review all receive workflow, risk, progress and prerequisite state.
 * Canceled tasks remain out of active planning surfaces, but blocked work stays
 * visible so older screens can explain why an assignment cannot proceed.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<SurfaceTask[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks/workspace", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      const next = Array.isArray(data?.tasks)
        ? data.tasks.filter((task: SurfaceTask) => task?.workflowState !== 'canceled') as SurfaceTask[]
        : [];
      setTasks(next);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load tasks");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onTasksChanged(() => { void refresh(); });
    const id = setInterval(() => { void refresh(); }, 60000);
    return () => { off(); clearInterval(id); };
  }, [refresh]);

  return { tasks, setTasks, loading, error, refresh };
}
