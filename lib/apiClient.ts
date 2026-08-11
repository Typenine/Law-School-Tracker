import { notifyToast } from '@/lib/toastBus';

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
};

export async function apiFetch<T = any>(url: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body } = opts;
  const isFormData = body instanceof FormData;
  // FormData must not get an explicit Content-Type: the browser needs to set
  // its own multipart boundary, and setting the key to `undefined` here would
  // otherwise send the literal header value "undefined".
  const mergedHeaders: Record<string, string> = isFormData
    ? { ...headers }
    : { 'Content-Type': 'application/json', ...headers };
  const init: RequestInit = {
    method,
    headers: mergedHeaders,
    body: isFormData ? body : (body != null ? JSON.stringify(body) : undefined),
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
