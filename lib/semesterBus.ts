import { createChangeBus } from '@/lib/changeBus';

const bus = createChangeBus('semesters', 'semesterActiveAt');

export function notifySemesterChanged(): void { bus.notify(); }
export function onSemesterChanged(cb: () => void): () => void { return bus.subscribe(cb); }
