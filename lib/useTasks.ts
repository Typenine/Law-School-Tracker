"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/lib/types";

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      const next = Array.isArray(data?.tasks) ? (data.tasks as Task[]) : [];
      setTasks(next);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tasks, setTasks, loading, error, refresh };
}
