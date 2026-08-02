/**
 * Lets a page publish a custom subtitle for the app header without reaching
 * into the DOM that React owns.
 */
type Listener = (subtitle: string | null) => void;

const listeners = new Set<Listener>();
let current: string | null = null;

export function setPageSubtitle(subtitle: string | null): void {
  current = subtitle;
  for (const listener of Array.from(listeners)) {
    try { listener(subtitle); } catch {}
  }
}

export function onPageSubtitle(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}
