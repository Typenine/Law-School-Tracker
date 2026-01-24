import { notifyToast } from '@/lib/toastBus';

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
};

export async function apiFetch<T = any>(url: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body } = opts;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': body instanceof FormData ? undefined as any : 'application/json',
      ...headers,
    },
    body: body instanceof FormData ? body : (body != null ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  };
  try {
    const res = await fetch(url, init);
    let data: any = null;
    try { data = await res.clone().json(); } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `${res.status} ${res.statusText}`;
      try { notifyToast({ kind: 'error', message: msg }); } catch {}
      throw new Error(msg);
    }
    return (data as T) ?? ({} as T);
  } catch (err: any) {
    const msg = err?.message || 'Network error';
    try { notifyToast({ kind: 'error', message: msg }); } catch {}
    throw err;
  }
}
