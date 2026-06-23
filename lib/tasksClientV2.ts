import type { NewTaskInput, Task, UpdateTaskInput } from './types';
import { apiFetch } from './apiClient';
import { notifyTasksChanged } from './taskBus';
import { notifyToast } from './toastBus';
import { courseIdFromTags, lifecycleFromTags, mergeTaskTags, normalizeTask, prepareTaskPayload } from './taskMetadata';
import { fetchTasksForClient, findGeneratedTask, resolveCourseIdForClient } from './taskClientHelpers';

type Options = { silent?: boolean };
type CreateInput = Omit<NewTaskInput, 'dependsOn'> & { dependsOn?: string | string[] | null };

function announce(message: string, options?: Options) {
  try {
    notifyTasksChanged();
    if (!options?.silent) notifyToast({ kind: 'success', message });
  } catch {}
}

async function create(input: CreateInput, options?: Options): Promise<Task> {
  const normalized: NewTaskInput = {
    ...input,
    dependsOn: typeof input.dependsOn === 'string' ? [input.dependsOn] : input.dependsOn,
  };
  const courseId = normalized.courseId !== undefined ? normalized.courseId : await resolveCourseIdForClient(normalized.course);
  const prepared = prepareTaskPayload({ ...normalized, courseId }) as NewTaskInput;
  const generated = findGeneratedTask(await fetchTasksForClient(), prepared.tags, courseId, prepared.course);
  if (generated) return update(generated.id, { ...prepared, lifecycle: 'active' }, options);
  const data = await apiFetch<{ task: Task }>('/api/tasks', { method: 'POST', body: prepared });
  announce('Task created.', options);
  return normalizeTask(data.task);
}

async function bulkCreate(items: NewTaskInput[], options?: Options): Promise<Task[]> {
  const prepared = await Promise.all(items.map(async item => {
    const courseId = item.courseId !== undefined ? item.courseId : await resolveCourseIdForClient(item.course);
    return prepareTaskPayload({ ...item, courseId }) as NewTaskInput;
  }));
  const data = await apiFetch<{ tasks: Task[] }>('/api/tasks/bulk', { method: 'POST', body: { tasks: prepared } });
  announce(`Created ${items.length} task${items.length === 1 ? '' : 's'}.`, options);
  return (data.tasks || []).map(normalizeTask);
}

async function update(id: string, patch: Partial<UpdateTaskInput>, options?: Options): Promise<Task> {
  const current = (await fetchTasksForClient()).find(task => task.id === id) || null;
  const courseId = patch.courseId !== undefined
    ? patch.courseId
    : patch.course !== undefined
      ? await resolveCourseIdForClient(patch.course)
      : current?.courseId || courseIdFromTags(current?.tags);
  const lifecycle = patch.lifecycle !== undefined
    ? patch.lifecycle
    : (patch.tags || []).includes('syllabus-removed')
      ? 'archived'
      : current?.lifecycle || lifecycleFromTags(current?.tags);
  const prepared = prepareTaskPayload({ ...patch, courseId, lifecycle }, current) as UpdateTaskInput;
  if (patch.tags !== undefined && current) prepared.tags = mergeTaskTags(current.tags, prepared.tags, { courseId, lifecycle });
  const data = await apiFetch<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body: prepared });
  announce(lifecycle === 'archived' ? 'Task archived.' : 'Task updated.', options);
  return normalizeTask(data.task);
}

async function archive(id: string, options?: Options) {
  return update(id, { lifecycle: 'archived', status: 'done', completedAt: null }, options);
}

async function remove(id: string, options?: Options) {
  await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
  announce('Task deleted.', options);
}

async function toggleDone(task: Task) {
  return update(task.id, { status: task.status === 'done' ? 'todo' : 'done', lifecycle: 'active' });
}

async function moveDueDate(id: string, dueDate: string) {
  return update(id, { dueDate });
}

export const tasksClient = { create, bulkCreate, update, archive, remove, toggleDone, moveDueDate };
