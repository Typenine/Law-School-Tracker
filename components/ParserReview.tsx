"use client";
import { useMemo, useState } from 'react';
import { NewTaskInput } from '@/lib/types';

type Row = NewTaskInput & { selected: boolean };

export default function ParserReview({ initial, onCancel, onSaved }: { initial: NewTaskInput[]; onCancel: () => void; onSaved: (createdCount: number) => void; }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(t => ({ ...t, selected: true })));
  const allSelected = useMemo(() => rows.every(r => r.selected), [rows]);

  function toggleAll(sel: boolean) {
    setRows(prev => prev.map(r => ({ ...r, selected: sel })));
  }

  function update(i: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  async function saveAll() {
    const toSave = rows.filter(r => r.selected).map(r => ({
      title: r.title,
      course: r.course ?? null,
      dueDate: r.dueDate,
      status: (r as any).status ?? 'todo',
      estimatedMinutes: r.estimatedMinutes ?? null,
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
      <div className="text-xs text-slate-300/70 mb-3">Edit, uncheck unwanted items, then Save All.</div>
      <div className="mb-2 flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} /> Select all
        </label>
        <button onClick={saveAll} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500">Save All</button>
        <button onClick={onCancel} className="px-3 py-2 rounded border border-[#1b2344]">Cancel</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-300/60">
            <tr>
              <th className="py-2 pr-4"></th>
              <th className="py-2 pr-4">Due</th>
              <th className="py-2 pr-4">Title</th>
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
