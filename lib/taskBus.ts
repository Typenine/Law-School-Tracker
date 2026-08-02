import { createChangeBus } from '@/lib/changeBus';

const bus = createChangeBus('tasks', 'tasksUpdatedAt');

export function notifyTasksChanged(): void { bus.notify(); }
export function onTasksChanged(cb: () => void): () => void { return bus.subscribe(cb); }
