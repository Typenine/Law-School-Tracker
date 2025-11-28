"use client";
import { useState, useEffect, useMemo } from 'react';
import { parsePageRanges, formatPageRanges, countPages, subtractPages } from '@/lib/pageRanges';

// Parse flexible time input (e.g., "90", "1h30m", "1:30")
function parseMinutesFlexible(input: string): number | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  // HH:MM format
  const colon = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const m = parseInt(colon[2], 10);
    if (!isNaN(h) && !isNaN(m)) return Math.max(0, h * 60 + m);
  }
  // Xh Ym or Xh or Ym
  let total = 0; let matched = false;
  const hr = /([0-9]+(?:\.[0-9]+)?)\s*h/.exec(s);
  if (hr) { const h = parseFloat(hr[1]); if (!isNaN(h)) { total += Math.round(h * 60); matched = true; } }
  const mr = /([0-9]+)\s*m(?![a-z])/i.exec(s);
  if (mr) { const m = parseInt(mr[1], 10); if (!isNaN(m)) { total += m; matched = true; } }
  if (matched) return Math.max(0, total);
  // Plain number => minutes
  const plain = parseFloat(s);
  if (!isNaN(plain)) return Math.round(plain);
  return null;
}

function minutesToHM(min: number): string {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function extractPageRanges(title: string): string[] {
  const pat = /(?:p\.?\s*|pages?\s+)(\d+[\d\s,–\-—to]+)/gi;
  const chips: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pat.exec(title)) !== null) {
    chips.push(match[1].trim());
  }
  return chips;
}

export type LogModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: LogSubmitData) => void;
  task: {
    id: string;
    title: string;
    course?: string | null;
    estimatedMinutes?: number | null;
    pagesRead?: number | null;
    originalPageRanges?: string | null;
    remainingPageRanges?: string | null;
  } | null;
  mode: 'partial' | 'finish';
  defaultMinutes?: number;
  coursePph?: number;
};

export type LogSubmitData = {
  minutes: number;
  focus: number;
  notes: string;
  pagesCompleted?: string;
  moveToDay?: string;
  isPartial: boolean;
  completionDate?: string;
};

export default function LogModal({ isOpen, onClose, onSubmit, task, mode, defaultMinutes, coursePph = 18 }: LogModalProps) {
  const [minutes, setMinutes] = useState('');
  const [focus, setFocus] = useState('5');
  const [notes, setNotes] = useState('');
  const [pagesCompleted, setPagesCompleted] = useState('');
  const [moveToDay, setMoveToDay] = useState('');
  const [completionDate, setCompletionDate] = useState('');

  // Determine if this is a reading task with page ranges
  const pageRanges = useMemo(() => {
    if (!task) return [];
    if (task.remainingPageRanges) {
      return [task.remainingPageRanges];
    }
    if (task.originalPageRanges) {
      return [task.originalPageRanges];
    }
    return extractPageRanges(task.title || '');
  }, [task]);

  const hasPages = pageRanges.length > 0;
  const totalPages = useMemo(() => {
    if (!hasPages) return 0;
    const ranges = parsePageRanges(pageRanges.join(', '));
    return countPages(ranges);
  }, [pageRanges, hasPages]);

  // Reset form when task changes
  useEffect(() => {
    if (isOpen && task) {
      const defaultMins = defaultMinutes || Math.round((task.estimatedMinutes || 30) * (mode === 'partial' ? 0.5 : 1));
      setMinutes(minutesToHM(Math.max(1, defaultMins)));
      setFocus(typeof window !== 'undefined' ? (localStorage.getItem('defaultFocus') || '5') : '5');
      setNotes('');
      setPagesCompleted('');
      setMoveToDay('');
      // Default completion date to today
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      setCompletionDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [isOpen, task, mode, defaultMinutes]);

  if (!isOpen || !task) return null;

  const handleSubmit = () => {
    const mins = parseMinutesFlexible(minutes);
    if (mins === null || mins <= 0) {
      alert('Please enter a valid duration');
      return;
    }

    const focusVal = parseFloat(focus);
    if (isNaN(focusVal) || focusVal < 1 || focusVal > 10) {
      alert('Focus must be between 1 and 10');
      return;
    }

    onSubmit({
      minutes: mins,
      focus: focusVal,
      notes,
      pagesCompleted: pagesCompleted || undefined,
      moveToDay: moveToDay || undefined,
      isPartial: mode === 'partial',
      completionDate: completionDate || undefined,
    });
  };

  const getFocusColor = (f: number) => {
    if (f >= 8) return 'text-emerald-400';
    if (f >= 6) return 'text-blue-400';
    if (f >= 4) return 'text-amber-400';
    return 'text-rose-400';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-[95vw] max-w-md bg-[#0f172a] border border-white/10 rounded-lg shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {mode === 'finish' ? 'Complete Task' : 'Log Partial Progress'}
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {task.course && <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 mr-2">{task.course}</span>}
            <span className="line-clamp-2">{task.title}</span>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Duration */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Duration</label>
            <input
              type="text"
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
              placeholder="e.g., 45, 1h30m, 1:30"
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="text-[11px] text-slate-500 mt-1">Formats: 90, 1h30m, 1:30</div>
          </div>

          {/* Focus slider */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Focus Level: <span className={`font-medium ${getFocusColor(parseFloat(focus) || 5)}`}>{parseFloat(focus).toFixed(1)}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={0.1}
              value={focus}
              onChange={e => setFocus(e.target.value)}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Completion Date */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Completion Date</label>
            <input
              type="date"
              value={completionDate}
              onChange={e => setCompletionDate(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Pages completed (for reading tasks) */}
          {hasPages && mode === 'partial' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Pages Completed <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={pagesCompleted}
                onChange={e => setPagesCompleted(e.target.value)}
                placeholder="e.g., 241-247, 250"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Assigned: {pageRanges.join(', ')} ({totalPages}p)
              </div>
            </div>
          )}

          {/* Move remaining to another day (for partial) */}
          {mode === 'partial' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Move Remaining to Day <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="date"
                value={moveToDay}
                onChange={e => setMoveToDay(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes <span className="text-slate-500">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any notes about this session..."
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-slate-300 hover:text-white hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded text-sm bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {mode === 'finish' ? 'Complete' : 'Log Progress'}
          </button>
        </div>
      </div>
    </div>
  );
}
