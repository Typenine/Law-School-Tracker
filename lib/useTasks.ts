"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/lib/types";
import { onTasksChanged } from "@/lib/taskBus";

/**
 * Shared task reads now come from the Task v2.1 workspace so Calendar,
 * Courses, Week Plan and other older consumers receive the same enriched task
 * objects (risk/progress/workflow metadata) as the Task Workspace. Blocked and
 * canceled work stays out of the legacy arrays because those surfaces are not
 * allowed to schedule or complete prerequisites accidentally; the global shell
 * and task drawer still expose those states explicitly.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks/workspace", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      const next = Array.isArray(data?.tasks)
        ? data.tasks.filter((task: any) => task?.workflowState !== 'canceled' && !task?.blocked) as Task[]
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
