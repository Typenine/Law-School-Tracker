import { notifyToast } from '@/lib/toastBus';

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
};

export type SyncState = 'online' | 'syncing' | 'unsynced';
export const SYNC_STATUS_EVENT = 'app:sync-status';
let pendingMutations = 0;

function broadcastSync(state: SyncState, message?: string) {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: { state, message } })); } catch {}
}

export async function apiFetch<T = any>(url: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body } = opts;
  const mutation = method !== 'GET';
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const mergedHeaders: Record<string, string> = isFormData ? { ...headers } : { 'Content-Type': 'application/json', ...headers };
  const init: RequestInit = {
    method,
    headers: mergedHeaders,
    body: isFormData ? body : (body != null ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  };

  if (mutation) {
    pendingMutations += 1;
    broadcastSync('syncing');
  }
  try {
    const res = await fetch(url, init);
    let data: any = null;
    try { data = await res.clone().json(); } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `${res.status} ${res.statusText}`;
      try { notifyToast({ kind: 'error', message: msg }); } catch {}
      if (mutation) broadcastSync('unsynced', msg);
      throw new Error(msg);
    }
    if (mutation) {
      pendingMutations = Math.max(0, pendingMutations - 1);
      if (pendingMutations === 0) broadcastSync('online');
    }
    return (data as T) ?? ({} as T);
  } catch (err: any) {
    const msg = err?.message || 'Network error';
    if (mutation) {
      pendingMutations = Math.max(0, pendingMutations - 1);
      broadcastSync('unsynced', msg);
    }
    try { notifyToast({ kind: 'error', message: msg }); } catch {}
    throw err;
  }
}
