export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type ToastEvent = {
  id?: string;
  kind?: ToastKind;
  title?: string;
  message: string;
  durationMs?: number;
};

const EVENT_NAME = 'app:toast';

export function notifyToast(toast: ToastEvent): void {
  if (typeof window === 'undefined') return;
  try {
    const evt = new CustomEvent<ToastEvent>(EVENT_NAME as any, { detail: toast });
    window.dispatchEvent(evt);
  } catch {}
}

export function onToast(cb: (t: ToastEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    try { cb((e as CustomEvent<ToastEvent>).detail); } catch {}
  };
  try { window.addEventListener(EVENT_NAME, handler as any); } catch {}
  return () => { try { window.removeEventListener(EVENT_NAME, handler as any); } catch {} };
}
