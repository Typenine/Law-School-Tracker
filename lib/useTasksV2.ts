"use client";

import { useCallback, useEffect, useState } from 'react';
import type { Task } from './types';
import { onTasksChanged } from './taskBus';
import { isActiveTask, normalizeTask } from './taskMetadata';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/tasks', { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load tasks');
      const data = await response.json();
      const normalized = Array.isArray(data?.tasks) ? data.tasks.map(normalizeTask) : [];
      setTasks(normalized.filter(isActiveTask));
      setError(null);
    } catch (cause: any) {
      setError(cause?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = onTasksChanged(() => { void refresh(); });
    const poll = window.setInterval(() => { void refresh(); }, 60000);
    return () => { unsubscribe(); window.clearInterval(poll); };
  }, [refresh]);

  return { tasks, setTasks, loading, error, refresh };
}
