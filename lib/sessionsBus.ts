import { createChangeBus } from '@/lib/changeBus';

const bus = createChangeBus('sessions', 'sessionsUpdatedAt');

export function notifySessionsChanged(): void { bus.notify(); }
export function onSessionsChanged(cb: () => void): () => void { return bus.subscribe(cb); }
