import { NewTaskInput, Task, UpdateTaskInput } from '@/lib/types';
import { notifyTasksChanged } from '@/lib/taskBus';
import { apiFetch } from '@/lib/apiClient';
import { notifyToast } from '@/lib/toastBus';

type ClientOpts = { silent?: boolean };
type CreateTaskInput = Omit<NewTaskInput, 'dependsOn'> & { dependsOn?: string | string[] | null };

function normalizeCreateInput(input: CreateTaskInput): NewTaskInput {
  return {
    ...input,
    dependsOn: typeof input.dependsOn === 'string' ? [input.dependsOn] : input.dependsOn,
  };
}

async function create(input: CreateTaskInput, opts?: ClientOpts): Promise<Task> {
  const data = await apiFetch<{ task: Task }>('/api/tasks', { method: 'POST', body: normalizeCreateInput(input) });
  try { notifyTasksChanged(); if (!opts?.silent) notifyToast({ kind: 'success', message: 'Task created.' }); } catch {}
  return (data as any).task as Task;
}

async function bulkCreate(items: NewTaskInput[], opts?: ClientOpts): Promise<Task[]> {
  const data = await apiFetch<{ tasks: Task[] }>('/api/tasks/bulk', { method: 'POST', body: { tasks: items } });
  try { notifyTasksChanged(); if (!opts?.silent) notifyToast({ kind: 'success', message: `Created ${(items||[]).length} task${(items||[]).length>1?'s':''}.` }); } catch {}
  return ((data as any).tasks || []) as Task[];
}

async function update(id: string, patch: UpdateTaskInput | Partial<UpdateTaskInput>, opts?: ClientOpts): Promise<Task> {
  const data = await apiFetch<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body: patch });
  try { notifyTasksChanged(); if (!opts?.silent) notifyToast({ kind: 'success', message: 'Task updated.' }); } catch {}
  return (data as any).task as Task;
}

async function remove(id: string, opts?: ClientOpts): Promise<void> {
  await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
  try { notifyTasksChanged(); if (!opts?.silent) notifyToast({ kind: 'success', message: 'Task deleted.' }); } catch {}
}

async function toggleDone(t: Task): Promise<Task> {
  const next = t.status === 'done' ? 'todo' : 'done';
  return update(t.id, { status: next } as any);
}

async function moveDueDate(id: string, iso: string): Promise<Task> {
  return update(id, { dueDate: iso } as any);
}

export const tasksClient = { create, bulkCreate, update, remove, toggleDone, moveDueDate };
