"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Task } from '@/lib/types';

export default function TaskTable() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newCourse, setNewCourse] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newEst, setNewEst] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'done'>('all');
  const [courseFilter, setCourseFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCourse, setEditCourse] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editEst, setEditEst] = useState<string>('');
  const [icsToken, setIcsToken] = useState<string>('');
  const [editPriority, setEditPriority] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editAttachments, setEditAttachments] = useState<string>('');
  const [editDepends, setEditDepends] = useState<string>('');
  const courseFilterRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState('');

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await res.json();
    setTasks(data.tasks as Task[]);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIcsToken(window.localStorage.getItem('icsToken') || '');
    const sf = window.localStorage.getItem('taskStatusFilter') as any;
    const cf = window.localStorage.getItem('taskCourseFilter');
    if (sf === 'all' || sf === 'todo' || sf === 'done') setStatusFilter(sf);
    if (typeof cf === 'string') setCourseFilter(cf);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('taskStatusFilter', statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('taskCourseFilter', courseFilter);
  }, [courseFilter]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as any).isContentEditable);
      if (!isTyping && e.key === '/') {
        e.preventDefault();
        courseFilterRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function toggleDone(t: Task) {
    const res = await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: t.status === 'done' ? 'todo' : 'done' }) });
    if (res.ok) refresh();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) setTasks(prev => prev.filter(t => t.id !== id));
  }

  async function quickAdd() {
    if (!newTitle || !newDue) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          course: newCourse || null,
          dueDate: new Date(newDue).toISOString(),
          status: 'todo',
          estimatedMinutes: newEst ? parseInt(newEst, 10) : null,
        }),
      });
      if (res.ok) {
        setNewTitle('');
        setNewCourse('');
        setNewDue('');
        setNewEst('');
        await refresh();
      }
    } catch (_) {}
  }

  function isoToLocalInput(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditCourse(t.course || '');
    setEditDue(isoToLocalInput(t.dueDate));
    setEditEst(t.estimatedMinutes?.toString() || '');
    setEditPriority(t.priority?.toString() || '');
    setEditNotes(t.notes || '');
    setEditAttachments((t.attachments || []).join(', '));
    setEditDepends((t.dependsOn || []).join(', '));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle('');
    setEditCourse('');
    setEditDue('');
  }

  async function saveEdit() {
    if (!editingId) return;
    const body: any = { title: editTitle, course: editCourse || null };
    if (editDue) body.dueDate = new Date(editDue).toISOString();
    body.estimatedMinutes = editEst ? parseInt(editEst, 10) : null;
    body.priority = editPriority ? parseInt(editPriority, 10) : null;
    body.notes = editNotes || null;
    body.attachments = editAttachments ? editAttachments.split(',').map(s => s.trim()).filter(Boolean) : null;
    body.dependsOn = editDepends ? editDepends.split(',').map(s => s.trim()).filter(Boolean) : null;
    const res = await fetch(`/api/tasks/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      cancelEdit();
      await refresh();
    }
  }

  const icsHref = useMemo(() => {
    const params: string[] = [];
    if (courseFilter) params.push(`course=${encodeURIComponent(courseFilter)}`);
    if (statusFilter !== 'all') params.push(`status=${encodeURIComponent(statusFilter)}`);
    if (icsToken) params.push(`token=${encodeURIComponent(icsToken)}`);
    return `/api/export/ics${params.length ? `?${params.join('&')}` : ''}`;
  }, [courseFilter, statusFilter, icsToken]);

  const csvHref = useMemo(() => {
    const params: string[] = [];
    if (courseFilter) params.push(`course=${encodeURIComponent(courseFilter)}`);
    if (statusFilter !== 'all') params.push(`status=${encodeURIComponent(statusFilter)}`);
    return `/api/tasks/export.csv${params.length ? `?${params.join('&')}` : ''}`;
  }, [courseFilter, statusFilter]);

  async function importCsv() {
    if (!importFile) return;
    try {
      setImportStatus('Uploading...');
      const fd = new FormData();
      fd.append('file', importFile);
      const res = await fetch('/api/tasks/import', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setImportStatus(`Imported ${data.created} tasks`);
      setImportFile(null);
      await refresh();
    } catch (e: any) {
      setImportStatus('Import failed: ' + (e?.message || 'Unknown error'));
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Tasks</h2>
      <form onSubmit={(e) => { e.preventDefault(); quickAdd(); }} className="mb-3 flex flex-col md:flex-row gap-3 md:items-end justify-between">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 w-full md:w-auto">
          <div className="flex gap-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title" className="flex-1 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <button type="button" onClick={async () => {
              if (!newTitle) return;
              try {
                const res = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newTitle }) });
                if (!res.ok) return;
                const data = await res.json();
                const t = (data.tasks || [])[0];
                if (!t) return;
                setNewTitle(t.title || newTitle);
                if (t.course) setNewCourse(t.course || '');
                if (t.dueDate) setNewDue(isoToLocalInput(t.dueDate));
                if (typeof t.estimatedMinutes === 'number') setNewEst(String(t.estimatedMinutes));
              } catch {}
            }} className="px-2 py-2 rounded border border-[#1b2344] text-xs">Parse</button>
          </div>
          <input value={newCourse} onChange={e => setNewCourse(e.target.value)} placeholder="Course (optional)" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          <input type="datetime-local" value={newDue} onChange={e => setNewDue(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          <input type="number" min={0} step={5} value={newEst} onChange={e => setNewEst(e.target.value)} placeholder="Est. min" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded disabled:opacity-50" disabled={!newTitle || !newDue}>Add Task</button>
        </div>
        <div className="flex gap-2">
          <a href={icsHref} className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500">Download .ics</a>
          <a href={csvHref} className="px-3 py-2 rounded bg-teal-600 hover:bg-teal-500">Export CSV</a>
          <button type="button" onClick={() => setImportOpen(v => !v)} className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500">{importOpen ? 'Close Import' : 'Import CSV'}</button>
          <button onClick={refresh} className="px-3 py-2 rounded border border-[#1b2344]">Refresh</button>
        </div>
      </form>
      {importOpen && (
        <div className="mb-4 border border-[#1b2344] rounded p-3 bg-[#0b1020]">
          <div className="text-xs text-slate-300/70 mb-2">Choose a CSV with columns: title, dueDate. Optional: course, status, estimatedMinutes, priority, notes.</div>
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv,text/csv" onChange={e => setImportFile(e.target.files?.[0] || null)} className="text-sm" />
            <button type="button" onClick={importCsv} disabled={!importFile} className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50">Upload</button>
            {importStatus && <div className="text-xs text-slate-300/70 ml-2">{importStatus}</div>}
          </div>
        </div>
      )}
      <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="all">All</option>
            <option value="todo">Todo</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Course contains</label>
          <input ref={courseFilterRef} value={courseFilter} onChange={e => setCourseFilter(e.target.value)} placeholder="e.g., Torts" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
      </div>
      {loading ? (
        <p className="text-sm">Loading...</p>
      ) : (tasks.filter(t => (statusFilter === 'all' || t.status === statusFilter) && (!courseFilter || (t.course || '').toLowerCase().includes(courseFilter.toLowerCase()))).length === 0 && tasks.length > 0) ? (
        <p className="text-sm text-slate-300/80">No matching tasks. Adjust filters.</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-slate-300/80">No tasks yet. Upload a syllabus or add tasks.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-2 pr-4">Due</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Course</th>
                <th className="py-2 pr-4">Est. min</th>
                <th className="py-2 pr-4">Pri</th>
                <th className="py-2 pr-4">Notes</th>
                <th className="py-2 pr-4">Links</th>
                <th className="py-2 pr-4">Deps</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks
                .filter(t => (statusFilter === 'all' || t.status === statusFilter) && (!courseFilter || (t.course || '').toLowerCase().includes(courseFilter.toLowerCase())))
                .map(t => (
                <tr key={t.id} className="border-t border-[#1b2344]">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === t.id ? (
                      <input type="datetime-local" value={editDue} onChange={e => setEditDue(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      new Date(t.dueDate).toLocaleString()
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === t.id ? (
                      <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      t.title
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === t.id ? (
                      <input value={editCourse} onChange={e => setEditCourse(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      t.course || '-'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === t.id ? (
                      <input type="number" min={0} step={5} value={editEst} onChange={e => setEditEst(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      t.estimatedMinutes ?? '-'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === t.id ? (
                      <input type="number" min={1} max={5} value={editPriority} onChange={e => setEditPriority(e.target.value)} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      t.priority ?? '-'
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[280px]">
                    {editingId === t.id ? (
                      <input value={editNotes} onChange={e => setEditNotes(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      <span className="truncate inline-block max-w-[260px] align-bottom">{t.notes || '-'}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[220px]">
                    {editingId === t.id ? (
                      <input value={editAttachments} onChange={e => setEditAttachments(e.target.value)} placeholder="Comma-separated URLs" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      (t.attachments && t.attachments.length > 0) ? (
                        <div className="flex gap-1 flex-wrap">
                          {t.attachments.map((u, i) => (
                            <a key={i} href={u} target="_blank" className="underline text-xs truncate max-w-[160px]">Link {i+1}</a>
                          ))}
                        </div>
                      ) : '-'
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[220px]">
                    {editingId === t.id ? (
                      <input value={editDepends} onChange={e => setEditDepends(e.target.value)} placeholder="Comma-separated task IDs" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      (t.dependsOn && t.dependsOn.length > 0) ? (
                        <span className="text-xs">{t.dependsOn.length} deps</span>
                      ) : '-'
                    )}
                  </td>
                  <td className="py-2 pr-4">{t.status}</td>
                  <td className="py-2 pr-4 space-x-2">
                    {editingId === t.id ? (
                      <>
                        <button onClick={saveEdit} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500">Save</button>
                        <button onClick={cancelEdit} className="px-2 py-1 rounded border border-[#1b2344]">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(t)} className="px-2 py-1 rounded border border-[#1b2344]">Edit</button>
                        <button onClick={() => toggleDone(t)} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500">{t.status === 'done' ? 'Undo' : 'Done'}</button>
                        <button onClick={() => remove(t.id)} className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
