import { createChangeBus } from '@/lib/changeBus';

const scheduleBus = createChangeBus('schedule', 'scheduleUpdatedAt');
const availabilityBus = createChangeBus('availability', 'availabilityUpdatedAt');

export function notifyScheduleChanged(): void { scheduleBus.notify(); }
export function onScheduleChanged(cb: () => void): () => void { return scheduleBus.subscribe(cb); }

export function notifyAvailabilityChanged(): void { availabilityBus.notify(); }
export function onAvailabilityChanged(cb: () => void): () => void { return availabilityBus.subscribe(cb); }
