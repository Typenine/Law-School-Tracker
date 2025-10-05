"use client";
import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function parseHHMM(v?: string | null): { h12: number; m: number; am: boolean } | null {
  if (!v || !/^\d{2}:\d{2}$/.test(v)) return null;
  const [hStr, mStr] = v.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  const am = h < 12;
  const h12 = ((h + 11) % 12) + 1; // 0->12, 13->1
  return { h12, m, am };
}

function toHHMM(h12: number, m: number, am: boolean): string {
  let h = h12 % 12;
  if (!am) h += 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function TimePickerField({ value, onChange, placeholder = "HH:MM", disabled, className }: Props) {
  const [open, setOpen] = useState(false);
  const [h12, setH12] = useState(12);
  const [m, setM] = useState(0);
  const [am, setAm] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Sync from external value
  useEffect(() => {
    const p = parseHHMM(value);
    if (p) { setH12(p.h12); setM(p.m); setAm(p.am); }
  }, [value]);

  // Close on outside click/escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onEsc);
      return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc); };
    }
  }, [open]);

  const minutes = useMemo(() => [0, 15, 30, 45], []);
  const hours = useMemo(() => [1,2,3,4,5,6,7,8,9,10,11,12], []);

  function apply() {
    const out = toHHMM(h12, m, am);
    onChange(out);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={`relative inline-block ${className || ''}`}>
      <button type="button" disabled={!!disabled} onClick={() => setOpen(o => !o)}
        className="w-[110px] text-left bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm disabled:opacity-50">
        {value ? value : <span className="text-slate-500">{placeholder}</span>}
      </button>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-64 rounded border border-[#1b2344] bg-[#0b1020] p-2 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-300/70">Pick time</div>
            <div className="inline-flex text-xs rounded overflow-hidden border border-[#1b2344]">
              <button onClick={() => setAm(true)} className={`px-2 py-1 ${am ? 'bg-[#1a2243]' : ''}`}>AM</button>
              <button onClick={() => setAm(false)} className={`px-2 py-1 ${!am ? 'bg-[#1a2243]' : ''}`}>PM</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] mb-1 text-slate-300/70">Hour</div>
              <div className="grid grid-cols-4 gap-1">
                {hours.map(h => (
                  <button key={h} onClick={() => setH12(h)}
                    className={`px-2 py-1 rounded border border-[#1b2344] text-sm ${h12===h? 'bg-[#1a2243]' : ''}`}>{h}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] mb-1 text-slate-300/70">Minute</div>
              <div className="grid grid-cols-4 gap-1">
                {minutes.map(mm => (
                  <button key={mm} onClick={() => setM(mm)}
                    className={`px-2 py-1 rounded border border-[#1b2344] text-sm ${m===mm? 'bg-[#1a2243]' : ''}`}>{String(mm).padStart(2,'0')}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-2 py-1 rounded border border-[#1b2344] text-sm">Cancel</button>
            <button onClick={apply} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Set</button>
          </div>
        </div>
      )}
    </div>
  );
}
