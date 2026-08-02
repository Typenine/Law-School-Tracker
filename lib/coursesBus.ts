import { createChangeBus } from '@/lib/changeBus';

const bus = createChangeBus('courses', 'coursesUpdatedAt');

export function notifyCoursesChanged(): void { bus.notify(); }
export function onCoursesChanged(cb: () => void): () => void { return bus.subscribe(cb); }
