"use client";
import { useMemo, useState } from 'react';
import { NewTaskInput } from '@/lib/types';

type Row = NewTaskInput & { selected: boolean };

function classify(title: string): 'Reading' | 'Assignment' | 'Exam/Quiz' | 'Discussion' | 'Other' {
  const l = title.toLowerCase();
  if (/(read|pages|chapter|ch\.|section|§|cb|casebook|supp|supplement|ucc|frcp|restatement|statute|article|notes)/i.test(l)) return 'Reading';
  if (/(memo|brief|paper|assignment|submit|response paper)/i.test(l)) return 'Assignment';
  if (/(quiz|exam|midterm|final)/i.test(l)) return 'Exam/Quiz';
  if (/(discussion)/i.test(l)) return 'Discussion';
  return 'Other';
}

export default function ParserReview({ initial, onCancel, onSaved, mppDefault }: { initial: NewTaskInput[]; onCancel: () => void; onSaved: (createdCount: number) => void; mppDefault?: number; }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(t => ({ ...t, selected: true })));
  const allSelected = useMemo(() => rows.every(r => r.selected), [rows]);
  const [batchCourse, setBatchCourse] = useState('');
  const [batchDue, setBatchDue] = useState('');
  const [batchPriority, setBatchPriority] = useState<string>('');
  const [mpp, setMpp] = useState<number>(() => (typeof mppDefault === 'number' && mppDefault > 0) ? mppDefault : 3);

  function toggleAll(sel: boolean) {
    setRows(prev => prev.map(r => ({ ...r, selected: sel })));
  }

  function update(i: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function applyBatchCourse() {
    if (!batchCourse) return;
    setRows(prev => prev.map(r => r.selected ? { ...r, course: batchCourse } : r));
  }

  function applyBatchDue() {
    if (!batchDue) return;
    const iso = new Date(batchDue).toISOString();
    setRows(prev => prev.map(r => r.selected ? { ...r, dueDate: iso } : r));
  }

  function applyBatchPriority() {
    const n = parseInt(batchPriority, 10);
    if (isNaN(n) || n < 1 || n > 5) return;
    setRows(prev => prev.map(r => r.selected ? { ...r, priority: n } : r));
  }

  function scaleEstimates() {
    const base = (typeof mppDefault === 'number' && mppDefault > 0) ? mppDefault : 3;
    const factor = mpp / base;
    if (!isFinite(factor) || factor <= 0) return;
    setRows(prev => prev.map(r => (r.selected && typeof r.estimatedMinutes === 'number') ? { ...r, estimatedMinutes: Math.max(0, Math.round(r.estimatedMinutes * factor)) } : r));
  }

  async function saveAll() {
    const toSave = rows.filter(r => r.selected).map(r => ({
      title: r.title,
      course: r.course ?? null,
      dueDate: r.dueDate,
      status: (r as any).status ?? 'todo',
      estimatedMinutes: r.estimatedMinutes ?? null,
      priority: (r as any).priority ?? null,
    })) as NewTaskInput[];
    if (!toSave.length) { onCancel(); return; }
    const res = await fetch('/api/tasks/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: toSave }) });
    if (res.ok) {
      const data = await res.json();
      onSaved(data.createdCount || toSave.length);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-medium mb-2">Review parsed tasks</h3>
      <div className="text-xs text-slate-300/70 mb-3">Edit, use batch tools, uncheck unwanted items, then Save All.</div>
      <div className="mb-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} /> Select all
          </label>
          <button onClick={saveAll} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500">Save All</button>
          <button onClick={onCancel} className="px-3 py-2 rounded border border-[#1b2344]">Cancel</button>
        </div>
        <div className="flex items-center gap-2">
          <input value={batchCourse} onChange={e => setBatchCourse(e.target.value)} placeholder="Set course for selected" className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
          <button onClick={applyBatchCourse} className="px-2 py-1 rounded border border-[#1b2344] text-sm">Apply</button>
        </div>
        <div className="flex items-center gap-2">
          <input type="datetime-local" value={batchDue} onChange={e => setBatchDue(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
          <button onClick={applyBatchDue} className="px-2 py-1 rounded border border-[#1b2344] text-sm">Set due for selected</button>
        </div>
        <div className="flex items-center gap-2">
          <select value={batchPriority} onChange={e => setBatchPriority(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm">
            <option value="">Priority…</option>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={applyBatchPriority} className="px-2 py-1 rounded border border-[#1b2344] text-sm">Apply</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-300/70">Minutes/page</label>
          <input type="number" min={1} step={1} value={mpp} onChange={e => setMpp(parseInt(e.target.value || '0', 10) || mpp)} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
          <button onClick={scaleEstimates} className="px-2 py-1 rounded border border-[#1b2344] text-sm">Scale estimates</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-300/60">
            <tr>
              <th className="py-2 pr-4"></th>
              <th className="py-2 pr-4">Due</th>
              <th className="py-2 pr-4">Title</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Course</th>
              <th className="py-2 pr-4">Est. min</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[#1b2344]">
                <td className="py-2 pr-4"><input type="checkbox" checked={r.selected} onChange={(e) => update(i, { selected: e.target.checked })} /></td>
                <td className="py-2 pr-4 whitespace-nowrap"><input type="datetime-local" value={new Date(r.dueDate).toISOString().slice(0,16)} onChange={e => update(i, { dueDate: new Date(e.target.value).toISOString() })} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" /></td>
                <td className="py-2 pr-4"><input value={r.title} onChange={e => update(i, { title: e.target.value })} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" /></td>
                <td className="py-2 pr-4 text-xs text-slate-300/70">{classify(r.title)}</td>
                <td className="py-2 pr-4"><input value={r.course || ''} onChange={e => update(i, { course: e.target.value || null })} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" /></td>
                <td className="py-2 pr-4"><input type="number" min={0} step={5} value={r.estimatedMinutes ?? ''} onChange={e => update(i, { estimatedMinutes: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
