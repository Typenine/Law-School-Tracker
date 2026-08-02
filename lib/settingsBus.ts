import { createChangeBus } from '@/lib/changeBus';

const bus = createChangeBus('settings', 'settingsUpdatedAt');

export function notifySettingsChanged(): void { bus.notify(); }
export function onSettingsChanged(cb: () => void): () => void { return bus.subscribe(cb); }
