"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { onToast, ToastEvent } from '@/lib/toastBus';

type T = ToastEvent & { id: string };

function uid() { return Math.random().toString(36).slice(2); }

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    const off = onToast((t) => {
      const id = t.id || uid();
      const item: T = { ...t, id };
      setItems((prev) => [...prev, item]);
      const ms = Math.max(1500, Math.min(15000, t.durationMs ?? 3500));
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), ms);
    });
    return off;
  }, []);

  const container = useMemo(() => (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
      {items.map((t) => {
        const kind = t.kind || 'info';
        const border = kind === 'success' ? 'border-emerald-600' : kind === 'error' ? 'border-rose-600' : kind === 'warning' ? 'border-amber-600' : 'border-blue-600';
        const bg = kind === 'success' ? 'bg-emerald-900/40' : kind === 'error' ? 'bg-rose-900/40' : kind === 'warning' ? 'bg-amber-900/30' : 'bg-[#0b1020]';
        const title = t.title || (kind === 'success' ? 'Success' : kind === 'error' ? 'Error' : kind === 'warning' ? 'Warning' : 'Notice');
        return (
          <div key={t.id} className={`pointer-events-auto rounded border ${border} ${bg} p-3 shadow`}>
            <div className="text-xs font-medium text-slate-200">{title}</div>
            <div className="text-[11px] text-slate-300/80 break-words">{t.message}</div>
          </div>
        );
      })}
    </div>
  ), [items]);

  return (
    <>
      {children}
      {container}
    </>
  );
}
