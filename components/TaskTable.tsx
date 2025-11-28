"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task, Course } from '@/lib/types';
import AddTaskPanel from '@/components/AddTaskPanel';
import MultiAddDrawer from '@/components/MultiAddDrawer';
import LogModal, { type LogSubmitData } from '@/components/LogModal';

function fmtHM(min: number | null | undefined): string {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function parseMinutesFlexible(input: string): number | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  // 1) HH:MM
  const colon = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const m = parseInt(colon[2], 10);
    if (!isNaN(h) && !isNaN(m)) return Math.max(0, h * 60 + m);
  }
  // 2) Xh Ym or Xh or Ym
  let total = 0; let matched = false;
  const hr = /([0-9]+(?:\.[0-9]+)?)\s*h/.exec(s);
  if (hr) { const h = parseFloat(hr[1]); if (!isNaN(h)) { total += Math.round(h * 60); matched = true; } }
  const mr = /([0-9]+)\s*m(?![a-z])/i.exec(s);
  if (mr) { const m = parseInt(mr[1], 10); if (!isNaN(m)) { total += m; matched = true; } }
  if (matched) return Math.max(0, total);
  // 3) Plain number => minutes
  const plain = parseFloat(s);
  if (!isNaN(plain)) {
    // Treat numbers >= 10 as minutes; small decimals as hours if suffixed with 'h' already handled
    if (plain > 0 && plain < 10 && /h\b/.test(s)) return Math.round(plain * 60);
    return Math.round(plain);
  }
  return null;
}

function minutesPerPage(): number {
  if (typeof window === 'undefined') return 3;
  const s = window.localStorage.getItem('minutesPerPage');
  const n = s ? parseFloat(s) : NaN;
  return !isNaN(n) && n > 0 ? n : 3;
}

function hueFromString(s: string): number { let h = 0; for (let i=0;i<s.length;i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
function fallbackCourseHsl(name?: string | null): string { const key=(name||'').toString().trim().toLowerCase(); if (!key) return 'hsl(215 16% 47%)'; const h=hueFromString(key); return `hsl(${h} 70% 55%)`; }

// Sanitize corrupted page ranges like "599[1808612" back to "599–612"
function sanitizeTitle(title: string): string {
  if (!title) return title;
  // Fix corrupted en-dash patterns: "599[1808612" -> "599–612"
  return title.replace(/(\d+)\[180\d*(\d{1,4})/g, '$1–$2');
}

function normCourseKey(name?: string | null): string {
  let x = (name || '').toString().toLowerCase().trim();
  if (!x) return '';
  x = x.replace(/&/g, 'and');
  x = x.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (/\blaw$/.test(x)) x = x.replace(/\s*law$/, '');
  return x;
}

export default function TaskTable() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [editTags, setEditTags] = useState<string>('');
  const courseFilterRef = useRef<HTMLInputElement>(null);
  const dueInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const [savedViews, setSavedViews] = useState<Array<{ name: string; course: string; status: 'all'|'todo'|'done'; tag?: string; text?: string }>>([]);
  const [newViewName, setNewViewName] = useState('');
  const [offlineCount, setOfflineCount] = useState<number>(0);
  const [tagFilter, setTagFilter] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [currentTerm, setCurrentTerm] = useState<string>('');
  const [tplStart, setTplStart] = useState<string>(''); // yyyy-mm-dd
  const [tplStepDays, setTplStepDays] = useState<string>('1');
  const [sessions, setSessions] = useState<any[]>([]);
  const [qaInput, setQaInput] = useState('');
  const [qaError, setQaError] = useState('');
  const [backlogCount, setBacklogCount] = useState<number>(0);
  const [timers, setTimers] = useState<Record<string, { accMs: number; running: boolean; startedAt?: number }>>({});
  const [timerTick, setTimerTick] = useState(0);
  // Log modal state
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalTask, setLogModalTask] = useState<Task | null>(null);
  const [logModalMode, setLogModalMode] = useState<'partial' | 'finish'>('finish');
  
  // Edit modal state (replaces inline editing)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalTask, setEditModalTask] = useState<Task | null>(null);
  const [editActivity, setEditActivity] = useState('');
  const [editPages, setEditPages] = useState('');
  
  // Undo support
  const [undoStack, setUndoStack] = useState<Array<{ type: 'delete' | 'update'; task: Task; prevState?: Task }>>([]);
  const [showUndo, setShowUndo] = useState(false);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await res.json();
    setTasks(data.tasks as Task[]);
    setLoading(false);
  }

  useEffect(() => {
    try {
      const obj: Record<string, CourseMppEntry> = {};
      for (const c of courses) {
        const key = (c.title || '').trim().toLowerCase(); if (!key) continue;
        const overEn = (c as any).overrideEnabled as boolean | null | undefined;
        const overVal = (c as any).overrideMpp as number | null | undefined;
        const learned = (c as any).learnedMpp as number | null | undefined;
        const eff = (overEn && typeof overVal==='number' && overVal>0) ? clamp(overVal,0.5,6.0) : (typeof learned==='number' ? clamp(learned,0.5,6.0) : undefined);
        const mpp = typeof eff === 'number' ? eff : minutesPerPage();
        obj[key] = { mpp, overrideEnabled: !!overEn, overrideMpp: overVal ?? null, sample: (c as any).learnedSample ?? null, updatedAt: (c as any).learnedUpdatedAt ?? null } as any;
      }
      if (Object.keys(obj).length) window.localStorage.setItem('courseMppMap', JSON.stringify(obj));
    } catch {}
  }, [courses]);

  async function refreshSessions() {
    try {
      const r = await fetch('/api/sessions', { cache: 'no-store' });
      const j = await r.json();
      setSessions(Array.isArray(j?.sessions) ? j.sessions : []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    refreshSessions();
  }, []);

  // Mirror core settings from server to local for cross-device consistency
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings?keys=minutesPerPage,internshipColor,sportsLawReviewColor,icsToken', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const s = (j?.settings || {}) as Record<string, any>;
        try {
          if (typeof s.minutesPerPage !== 'undefined' && typeof window !== 'undefined') {
            const n = Math.max(1, Math.round(parseFloat(String(s.minutesPerPage)) || 3));
            window.localStorage.setItem('minutesPerPage', String(n));
          }
          if (typeof s.internshipColor === 'string' && typeof window !== 'undefined') window.localStorage.setItem('internshipColor', s.internshipColor);
          if (typeof s.sportsLawReviewColor === 'string' && typeof window !== 'undefined') window.localStorage.setItem('sportsLawReviewColor', s.sportsLawReviewColor);
          if (typeof s.icsToken === 'string') setIcsToken(s.icsToken);
        } catch {}
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { const raw = window.localStorage.getItem('taskTimersV1') || '{}'; const obj = JSON.parse(raw) || {}; setTimers(obj); } catch {}
  }, []);
  // Load task timers from server if available
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings?keys=taskTimersV1', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const s = (j?.settings || {}) as Record<string, any>;
        const tt = s.taskTimersV1;
        if (tt && typeof tt === 'object') setTimers(tt as any);
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem('taskTimersV1', JSON.stringify(timers)); } catch {}
  }, [timers]);
  // Debounced persist of timers to server
  useEffect(() => {
    const id = setTimeout(() => {
      try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskTimersV1: timers }) }); } catch {}
    }, 1000);
    return () => clearTimeout(id);
  }, [timers]);
  useEffect(() => {
    const id = setInterval(() => setTimerTick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function elapsedMs(id: string): number { const t = timers[id]; return t ? (t.accMs + (t.running ? (Date.now() - (t.startedAt || Date.now())) : 0)) : 0; }
  function startTimerFor(id: string) { setTimers(prev => { const t = prev[id] || { accMs: 0, running: false }; return { ...prev, [id]: { accMs: t.accMs, running: true, startedAt: Date.now() } }; }); }
  function pauseTimerFor(id: string) { setTimers(prev => { const t = prev[id]; if (!t || !t.running) return prev; const delta = Date.now() - (t.startedAt || Date.now()); return { ...prev, [id]: { accMs: t.accMs + Math.max(0, delta), running: false } }; }); }
  function clearTimerFor(id: string) { setTimers(prev => { const next = { ...prev }; delete next[id]; return next; }); }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/courses', { cache: 'no-store' });
        const j = await r.json();
        setCourses(Array.isArray(j?.courses) ? j.courses : []);
      } catch {}
    })();
  }, []);

  const colorForCourse = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of (courses||[])) {
      const key = normCourseKey(c?.title || '');
      const col = (c?.color || '').toString().trim();
      if (key && col) map[key] = col;
    }
    return (name?: string | null) => {
      const raw = (name || '').toString();
      const k = normCourseKey(raw);
      try { if (typeof window !== 'undefined' && k === 'internship') { const ls = window.localStorage.getItem('internshipColor'); if (ls) return ls; } } catch {}
      try { if (typeof window !== 'undefined' && k === 'sports law review') { const ls = window.localStorage.getItem('sportsLawReviewColor'); if (ls) return ls; } } catch {}
      return map[k] || fallbackCourseHsl(raw || '');
    };
  }, [courses]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIcsToken(window.localStorage.getItem('icsToken') || '');
    const sf = window.localStorage.getItem('taskStatusFilter') as any;
    const cf = window.localStorage.getItem('taskCourseFilter');
    if (sf === 'all' || sf === 'todo' || sf === 'done') setStatusFilter(sf);
    if (typeof cf === 'string') setCourseFilter(cf);
    // URL params override
    try {
      const u = new URL(window.location.href);
      const qCourse = u.searchParams.get('course');
      const qStatus = u.searchParams.get('status') as any;
      const qTag = u.searchParams.get('tag');
      const qText = u.searchParams.get('text');
      if (typeof qCourse === 'string') setCourseFilter(qCourse);
      if (qStatus === 'all' || qStatus === 'todo' || qStatus === 'done') setStatusFilter(qStatus);
      if (typeof qTag === 'string') setTagFilter(qTag);
      if (typeof qText === 'string') setTextFilter(qText);
    } catch {}
    // Saved views
    try {
      const s = window.localStorage.getItem('savedTaskViews');
      let views: Array<{ name: string; course: string; status: 'all'|'todo'|'done'; tag?: string; text?: string }> = [] as any;
      if (s) {
        try { views = JSON.parse(s); } catch { views = []; }
      }
      // No default Inbox view in redesigned Tasks
      setSavedViews(views);
      window.localStorage.setItem('savedTaskViews', JSON.stringify(views));
    } catch {}
    // Offline queue count
    try {
      const q = window.localStorage.getItem('offlineQueue');
      if (q) setOfflineCount(JSON.parse(q).length || 0);
    } catch {}
    try {
      const t = window.localStorage.getItem('currentTerm') || '';
      setCurrentTerm(t);
    } catch {}
    try {
      const raw = window.localStorage.getItem('backlogItemsV1') || '[]';
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setBacklogCount(arr.length);
    } catch {}
  }, []);

  // Flush offline queue when the app regains connectivity
  useEffect(() => {
    async function flushOfflineQueue() {
      try {
        const raw = window.localStorage.getItem('offlineQueue') || '[]';
        let arr: any[] = [];
        try { arr = JSON.parse(raw); } catch { arr = []; }
        if (!Array.isArray(arr) || arr.length === 0) return;
        const remaining: any[] = [];
        for (const item of arr) {
          try {
            const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
            if (!res.ok) throw new Error('failed');
          } catch {
            remaining.push(item);
          }
        }
        window.localStorage.setItem('offlineQueue', JSON.stringify(remaining));
        setOfflineCount(remaining.length);
        if (remaining.length !== arr.length) await refresh();
      } catch {}
    }
    function onOnline() { flushOfflineQueue(); }
    window.addEventListener('online', onOnline);
    // Try immediately if we're online and have items
    if (navigator.onLine) onOnline();
    return () => window.removeEventListener('online', onOnline);
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

  function openLogModal(t: Task, mode: 'partial' | 'finish') {
    setLogModalTask(t);
    setLogModalMode(mode);
    setLogModalOpen(true);
  }

  async function handleLogSubmit(data: LogSubmitData) {
    if (!logModalTask) return;
    const t = logModalTask;
    
    // Log the session
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: t.id,
          taskTitle: t.title,
          course: t.course || null,
          minutes: data.minutes,
          focus: data.focus,
          notes: data.notes || null,
          when: new Date().toISOString(),
        }),
      });
    } catch {}

    // Update task based on mode
    if (data.isPartial) {
      // Partial: reduce estimated time, keep as todo
      const newEst = Math.max(0, (t.estimatedMinutes || 0) - data.minutes);
      try {
        await fetch(`/api/tasks/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estimatedMinutes: newEst }),
        });
      } catch {}
    } else {
      // Finish: mark as done
      try {
        await fetch(`/api/tasks/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'done', actualMinutes: data.minutes }),
        });
      } catch {}
      clearTimerFor(t.id);
    }

    setLogModalOpen(false);
    setLogModalTask(null);
    refresh();
    refreshSessions();
  }

  async function toggleDone(t: Task) {
    const markingDone = t.status !== 'done';
    if (markingDone) {
      // Open log modal instead of prompt
      openLogModal(t, 'finish');
      return;
    }
    // Un-marking done - just toggle status
    const res = await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'todo' }) });
    if (res.ok) refresh();
  }

  async function remove(id: string) {
    const taskToDelete = tasks.find(t => t.id === id);
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setTasks(prev => prev.filter(t => t.id !== id));
      // Add to undo stack
      if (taskToDelete) {
        setUndoStack(prev => [...prev.slice(-9), { type: 'delete', task: taskToDelete }]);
        setShowUndo(true);
        setTimeout(() => setShowUndo(false), 8000);
      }
    }
  }

  async function undoLast() {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    
    if (last.type === 'delete') {
      // Recreate the deleted task
      const { id, ...taskData } = last.task;
      try {
        await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskData),
        });
        await refresh();
      } catch {}
    } else if (last.type === 'update' && last.prevState) {
      // Restore previous state
      try {
        await fetch(`/api/tasks/${last.task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(last.prevState),
        });
        await refresh();
      } catch {}
    }
    
    setUndoStack(prev => prev.slice(0, -1));
    setShowUndo(false);
  }

  // Calculate focus average per task from sessions
  const focusAvgByTask = useMemo(() => {
    const map: Record<string, { sum: number; count: number }> = {};
    for (const s of sessions) {
      const tid = s?.taskId;
      const focus = Number(s?.focus);
      if (tid && !isNaN(focus) && focus > 0) {
        if (!map[tid]) map[tid] = { sum: 0, count: 0 };
        map[tid].sum += focus;
        map[tid].count++;
      }
    }
    const result: Record<string, number> = {};
    for (const [tid, { sum, count }] of Object.entries(map)) {
      result[tid] = Math.round((sum / count) * 10) / 10;
    }
    return result;
  }, [sessions]);

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

  function openEditModal(t: Task) {
    setEditModalTask(t);
    setEditTitle(t.title);
    setEditCourse(t.course || '');
    setEditDue(isoToLocalInput(t.dueDate));
    setEditEst(t.estimatedMinutes?.toString() || '');
    setEditPriority(t.priority?.toString() || '');
    setEditNotes(t.notes || '');
    setEditAttachments((t.attachments || []).join(', '));
    setEditDepends((t.dependsOn || []).join(', '));
    setEditTags((t.tags || []).join(', '));
    setEditActivity((t as any).activity || '');
    setEditPages(typeof (t as any).pagesRead === 'number' ? String((t as any).pagesRead) : '');
    setEditModalOpen(true);
  }

  function closeEditModal() {
    setEditModalOpen(false);
    setEditModalTask(null);
    setEditTitle('');
    setEditCourse('');
    setEditDue('');
    setEditEst('');
    setEditPriority('');
    setEditNotes('');
    setEditActivity('');
    setEditPages('');
  }

  async function saveEditModal() {
    if (!editModalTask) return;
    const body: any = { 
      title: editTitle, 
      course: editCourse || null,
      activity: editActivity || null,
      pagesRead: editPages ? parseInt(editPages, 10) : null,
    };
    if (editDue) body.dueDate = new Date(editDue).toISOString();
    body.estimatedMinutes = editEst ? parseInt(editEst, 10) : null;
    body.priority = editPriority ? parseInt(editPriority, 10) : null;
    body.notes = editNotes || null;
    body.attachments = editAttachments ? editAttachments.split(',').map((s: string) => s.trim()).filter(Boolean) : null;
    body.dependsOn = editDepends ? editDepends.split(',').map((s: string) => s.trim()).filter(Boolean) : null;
    body.tags = editTags ? editTags.split(',').map((s: string) => s.trim()).filter(Boolean) : null;
    const res = await fetch(`/api/tasks/${editModalTask.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      closeEditModal();
      await refresh();
    }
  }
  
  // Legacy inline edit functions (kept for compatibility but now opens modal)
  function startEdit(t: Task) {
    openEditModal(t);
  }

  function cancelEdit() {
    closeEditModal();
  }

  async function saveEdit() {
    await saveEditModal();
  }

  const icsHref = useMemo(() => {
    const params: string[] = [];
    if (courseFilter) params.push(`course=${encodeURIComponent(courseFilter)}`);
    if (statusFilter !== 'all') params.push(`status=${encodeURIComponent(statusFilter)}`);
    if (icsToken) params.push(`token=${encodeURIComponent(icsToken)}`);
    return `/api/export/ics${params.length ? `?${params.join('&')}` : ''}`;
  }, [courseFilter, statusFilter, icsToken]);

  type CourseMppEntry = { mpp: number; sample?: number | null; updatedAt?: string | null; overrideEnabled?: boolean | null; overrideMpp?: number | null };
  function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
  const mppByCourseEffective = useMemo(() => {
    const map = new Map<string, number>();
    // Prefer localStorage map if present
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('courseMppMap') : null;
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, CourseMppEntry>;
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v.mpp === 'number' && v.mpp > 0) map.set(k, clamp(v.mpp, 0.5, 6.0));
        }
      }
    } catch {}
    // Fall back to API courses
    for (const c of courses) {
      const key = (c.title || '').trim().toLowerCase(); if (!key) continue;
      const overEn = (c as any).overrideEnabled as boolean | null | undefined;
      const overVal = (c as any).overrideMpp as number | null | undefined;
      const learned = (c as any).learnedMpp as number | null | undefined;
      const eff = (overEn && typeof overVal==='number' && overVal>0) ? clamp(overVal,0.5,6.0) : (typeof learned==='number' ? clamp(learned,0.5,6.0) : undefined);
      if (typeof eff === 'number') map.set(key, eff);
    }
    return map;
  }, [courses]);

  function effectiveMppForCourse(course: string): number {
    const key = (course || '').trim().toLowerCase();
    const fromMap = mppByCourseEffective.get(key);
    if (typeof fromMap === 'number' && fromMap > 0) return fromMap;
    return minutesPerPage();
  }

  function saveCurrentView() {
    const name = newViewName.trim();
    if (!name) return;
    const view = { name, course: courseFilter, status: statusFilter, tag: tagFilter || undefined, text: textFilter || '' } as any;
    const next = savedViews.filter(v => v.name.toLowerCase() !== name.toLowerCase());
    next.push(view);
    setSavedViews(next);
    try { window.localStorage.setItem('savedTaskViews', JSON.stringify(next)); } catch {}
    setNewViewName('');
  }
  function applyView(v: { name: string; course: string; status: 'all'|'todo'|'done'; tag?: string; text?: string }) {
    setCourseFilter(v.course || '');
    setStatusFilter(v.status);
    setTagFilter(v.tag || '');
    setTextFilter((v as any).text || '');
  }
  function deleteView(name: string) {
    const next = savedViews.filter(v => v.name.toLowerCase() !== name.toLowerCase());
    setSavedViews(next);
    try { window.localStorage.setItem('savedTaskViews', JSON.stringify(next)); } catch {}
  }

  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDue, setBulkDue] = useState<string>(''); // yyyy-mm-dd
  const [bulkCourse, setBulkCourse] = useState<string>('');
  const [bulkAddTag, setBulkAddTag] = useState<string>('');
  const [bulkRemoveTag, setBulkRemoveTag] = useState<string>('');
  const [bulkPriority, setBulkPriority] = useState<string>('');

  const filteredTasks = useMemo(() => {
    return tasks
      .filter(t => (statusFilter === 'all' || t.status === statusFilter))
      .filter(t => {
        if (!courseFilter) return true;
        const dc = displayCourseForTask(t);
        return (dc || '').toLowerCase().includes(courseFilter.toLowerCase());
      })
      .filter(t => (!tagFilter || (t.tags || []).some(tag => tag.toLowerCase().includes(tagFilter.toLowerCase()))))
      .filter(t => (!textFilter || (t.title || '').toLowerCase().includes(textFilter.toLowerCase())));
  }, [tasks, statusFilter, courseFilter, tagFilter, textFilter]);

  const allSelected = filteredTasks.length > 0 && filteredTasks.every(t => selected.has(t.id));
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(prev => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      filteredTasks.forEach(t => next.add(t.id));
      return next;
    });
  }

  async function bulkPatch(build: (t: Task) => any | null | undefined) {
    const list = tasks.filter(t => selected.has(t.id));
    await Promise.all(list.map(async (t) => {
      const body = build(t);
      if (!body || Object.keys(body).length === 0) return;
      await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }));
    setSelected(new Set());
    await refresh();
  }
  async function bulkDelete() {
    const list = tasks.filter(t => selected.has(t.id));
    await Promise.all(list.map(async (t) => {
      await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
    }));
    setSelected(new Set());
    await refresh();
  }

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

  const tasksById = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of tasks) if (t && (t as any).id) m.set((t as any).id, t);
    return m;
  }, [tasks]);

  function extractCourseFromNotes(notes?: string | null): string {
    if (!notes) return '';
    const m = notes.match(/^\s*\[([^\]]+)\]/);
    return m ? m[1].trim() : '';
  }

  function normActivity(a?: string | null): string {
    const x = (a || '').toLowerCase();
    if (x === 'reading') return 'reading';
    if (x === 'review') return 'review';
    if (x === 'outline') return 'outline';
    if (x === 'practice') return 'practice';
    if (x === 'internship') return 'other';
    return 'other';
  }

  const displayCourseForTask = (t: Task): string => {
    const raw = (t.course || '').trim();
    if (raw) return raw;
    const act = (t.activity || '').toLowerCase();
    if (act === 'internship') return 'Internship';
    const titleL = (t.title || '').toLowerCase();
    const tagsL: string[] = Array.isArray((t as any).tags) ? ((t as any).tags as string[]).map(s=>String(s).toLowerCase()) : [];
    if (titleL.includes('sports law review') || tagsL.includes('sports law review') || /\bslr\b/i.test(t.title || '')) return 'Sports Law Review';
    return '';
  };

  const pace = useMemo(() => {
    const sumsPages: Record<string, { minutes: number; pages: number }> = {};
    let globalPages = { minutes: 0, pages: 0 };
    const sumsAct: Record<string, { minutes: number; count: number }> = {};
    const globalAct: Record<string, { minutes: number; count: number }> = {};
    for (const s of sessions) {
      const t = s.taskId ? tasksById.get(s.taskId) : null;
      let course = (t?.course || ((s.activity||'').toLowerCase()==='internship' ? 'Internship' : extractCourseFromNotes(s.notes)) || '').toString().trim().toLowerCase();
      if (!course) course = 'unassigned';
      const minutes = Math.max(0, Number(s.minutes) || 0);
      const pages = Math.max(0, Number(s.pagesRead) || 0);
      const act = normActivity(s.activity);
      if (pages > 0 && minutes > 0) {
        const rec = (sumsPages[course] ||= { minutes: 0, pages: 0 });
        rec.minutes += minutes; rec.pages += pages;
        globalPages.minutes += minutes; globalPages.pages += pages;
      }
      const key = `${course}::${act}`;
      const ra = (sumsAct[key] ||= { minutes: 0, count: 0 });
      ra.minutes += minutes; ra.count += 1;
      const ga = (globalAct[act] ||= { minutes: 0, count: 0 });
      ga.minutes += minutes; ga.count += 1;
    }
    const mppByCourse: Record<string, number> = {};
    for (const [c, v] of Object.entries(sumsPages)) if (v.pages > 0) mppByCourse[c] = v.minutes / v.pages;
    const globalMPP = globalPages.pages > 0 ? (globalPages.minutes / globalPages.pages) : null;
    const avgByCourseActivity: Record<string, number> = {};
    for (const [k, v] of Object.entries(sumsAct)) if (v.count > 0) avgByCourseActivity[k] = v.minutes / v.count;
    const globalAvgByActivity: Record<string, number> = {};
    for (const [k, v] of Object.entries(globalAct)) if (v.count > 0) globalAvgByActivity[k] = v.minutes / v.count;
    return { mppByCourse, globalMPP, avgByCourseActivity, globalAvgByActivity };
  }, [sessions, tasksById]);

  function detectActivityFromTitle(title: string): string {
    const l = (title || '').toLowerCase();
    if (/(\bread\b|\bpp\.|pages?|\bch(\.|apter)?\b)/.test(l)) return 'reading';
    if (/outline/.test(l)) return 'outline';
    if (/(practice|problems?|hypos?|questions?)/.test(l)) return 'practice';
    if (/(review)/.test(l)) return 'review';
    return 'other';
  }

  function estimateFromHistory(course: string, title: string, pages: number | null | undefined, fallbackMpp?: number): number | null {
    const c = (course || '').trim().toLowerCase() || 'unassigned';
    const act = detectActivityFromTitle(title);
    if (pages && pages > 0) {
      const mpp = (pace.mppByCourse[c] ?? pace.globalMPP ?? fallbackMpp ?? minutesPerPage());
      return Math.round(pages * mpp);
    }
    const key = `${c}::${act}`;
    const avg = pace.avgByCourseActivity[key] ?? pace.globalAvgByActivity[act] ?? null;
    return avg ? Math.round(avg) : null;
  }

  function nextDowYmd(token: string): string | null {
    const map: Record<string, number> = { sun:0,sunday:0, mon:1,monday:1, tue:2,tues:2,tuesday:2, wed:3,weds:3,wednesday:3, thu:4,thurs:4,thursday:4, fri:5,friday:5, sat:6,saturday:6 };
    const k = token.trim().toLowerCase();
    if (!(k in map)) return null;
    const target = map[k];
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = base.getDay();
    let delta = (target - dow + 7) % 7;
    if (delta === 0) delta = 7;
    const out = new Date(base);
    out.setDate(out.getDate() + delta);
    const ymd = `${out.getFullYear()}-${String(out.getMonth()+1).padStart(2,'0')}-${String(out.getDate()).padStart(2,'0')}`;
    return ymd;
  }

  function parseQuick(input: string): { course: string; title: string; dueYmd: string | null; pages: number | null } | null {
    const s = (input || '').trim();
    if (!s) return null;
    const m = /^\s*([^:]+):\s*(.+)$/.exec(s);
    if (!m) return null;
    const course = m[1].trim();
    let rest = m[2].trim();
    const dueMatch = rest.match(/[\-–—]\s*due\s+([A-Za-z]+)/i);
    let dueDate: string | null = null;
    if (dueMatch) {
      const tok = dueMatch[1];
      const ymd = nextDowYmd(tok);
      if (ymd) dueDate = ymd;
      rest = rest.slice(0, dueMatch.index).trim();
    }
    let pages: number | null = null;
    const pM = rest.match(/\((\d{1,4})\s*p\)/i);
    if (pM) {
      const n = parseInt(pM[1], 10);
      if (!isNaN(n)) pages = n;
    }
    const title = rest.trim();
    if (!title) return null;
    return { course, title, dueYmd: dueDate, pages };
  }

  function endOfDayIso(ymd?: string | null): string {
    const d = ymd ? new Date(`${ymd}T23:59:59`) : new Date();
    if (!ymd) { d.setHours(23,59,59,999); }
    return d.toISOString();
  }

  async function addQuick() {
    setQaError('');
    const parsed = parseQuick(qaInput);
    if (!parsed) { setQaError('Use: COURSE: Title (24p) – due Fri'); return; }
    const pages = parsed.pages ?? null;
    let learnedUsed = false;
    let est: number | null = null;
    if (pages && pages > 0) {
      const mpp = effectiveMppForCourse(parsed.course);
      est = Math.round(pages * mpp + 10);
      // learnedUsed if the map had an explicit value for this course
      const key = (parsed.course || '').trim().toLowerCase();
      learnedUsed = mppByCourseEffective.has(key);
    }
    if (!est) est = estimateFromHistory(parsed.course, parsed.title, pages, minutesPerPage());
    if (!est && pages && pages > 0) est = Math.round(pages * minutesPerPage());
    const body: any = {
      title: parsed.title,
      course: parsed.course || null,
      dueDate: endOfDayIso(parsed.dueYmd),
      status: 'todo',
      estimatedMinutes: est ?? null,
      priority: null,
      tags: learnedUsed ? ['inbox','learned'] : ['inbox'],
      term: currentTerm || null,
    };
    try {
      const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('failed');
      setQaInput('');
      await refresh();
    } catch (e: any) {
      setQaError('Failed to add');
    }
  }

  async function migrateBacklogToInbox() {
    try {
      const raw = window.localStorage.getItem('backlogItemsV1') || '[]';
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return;
      const payload = arr.map((it: any) => {
        const dueIso = it.dueDate ? endOfDayIso(it.dueDate) : endOfDayIso();
        const tags = Array.isArray(it.tags) ? Array.from(new Set([...(it.tags||[]), 'inbox'])) : ['inbox'];
        return { title: it.title, course: it.course || null, dueDate: dueIso, status: 'todo', estimatedMinutes: it.estimatedMinutes ?? null, priority: it.priority ?? null, tags, term: currentTerm || null };
      });
      const res = await fetch('/api/tasks/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: payload }) });
      if (res.ok) {
        window.localStorage.setItem('backlogItemsV1', '[]');
        setBacklogCount(0);
        await refresh();
      }
    } catch {}
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Tasks</h2>
      {offlineCount > 0 && (
        <div className="mb-2 text-xs text-slate-300/80 flex items-center gap-2">
          <span>Pending offline: {offlineCount}</span>
          <button onClick={async () => {
            try {
              const raw = window.localStorage.getItem('offlineQueue') || '[]';
              let arr: any[] = [];
              try { arr = JSON.parse(raw); } catch { arr = []; }
              if (!arr.length) return;
              const remaining: any[] = [];
              for (const item of arr) {
                try {
                  const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
                  if (!res.ok) throw new Error('failed');
                } catch {
                  remaining.push(item);
                }
              }
              window.localStorage.setItem('offlineQueue', JSON.stringify(remaining));
              setOfflineCount(remaining.length);
              if (remaining.length !== arr.length) await refresh();
            } catch {}
          }} className="px-2 py-1 rounded border border-[#1b2344]">Sync now</button>
        </div>
      )}
      {/* Saved Filters */}
      <div className="mb-3 border border-[#1b2344] rounded p-3 bg-[#0b1020]">
        <div className="flex flex-wrap items-end gap-2">
          <div className="text-xs text-slate-300/70">Saved Filters:</div>
          {savedViews.length === 0 ? (
            <div className="text-xs text-slate-300/60">None yet</div>
          ) : (
            savedViews.map(v => (
              <div key={v.name} className="flex items-center gap-1 text-xs border border-[#1b2344] rounded px-1.5 py-0.5">
                <button onClick={() => applyView(v)} className="underline decoration-dotted">{v.name}</button>
                <button aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v.name)} className="text-rose-400">×</button>
              </div>
            ))
          )}
          <div className="ml-auto flex items-center gap-2">
            <input value={newViewName} onChange={e=>setNewViewName(e.target.value)} placeholder="Save current as…" className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" />
            <button onClick={saveCurrentView} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button>
            <button onClick={()=>setImportOpen(v=>!v)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">{importOpen ? 'Close Multi-Add' : 'Multi-Add'}</button>
          </div>
        </div>
      </div>
      <div className="mb-3 flex gap-2">
        <button onClick={refresh} className="px-3 py-2 rounded border border-[#1b2344]">Refresh</button>
        {backlogCount > 0 && (
          <button onClick={migrateBacklogToInbox} className="px-3 py-2 rounded border border-[#1b2344]">Import Backlog ({backlogCount})</button>
        )}
      </div>
      {/* Add Task Panel */}
      <AddTaskPanel onCreated={refresh} />
      {/* Course templates (local) */}
      <div className="mb-3 border border-[#1b2344] rounded p-3 bg-[#0b1020]">
        <div className="text-xs text-slate-300/70 mb-2">Templates per course (local). Use a course filter to select course.</div>
        <div className="flex flex-col md:flex-row gap-2 md:items-end">
          <input value={tplStart} onChange={e => setTplStart(e.target.value)} type="date" className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300/70">Step (days)</span>
            <input value={tplStepDays} onChange={e => setTplStepDays(e.target.value)} type="number" min={1} step={1} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="px-3 py-2 rounded border border-[#1b2344] disabled:opacity-50" disabled={!courseFilter}
              onClick={() => {
                if (!courseFilter) return;
                const list = tasks.filter(t => (t.course || '').toLowerCase().includes(courseFilter.toLowerCase()));
                const tpl = list.map(t => ({ title: t.title, course: t.course || '', estimatedMinutes: t.estimatedMinutes || null, priority: t.priority || null, tags: t.tags || [] }));
                try { window.localStorage.setItem(`courseTemplate:${courseFilter.toLowerCase()}`, JSON.stringify(tpl)); } catch {}
              }}>Save template</button>
            <button type="button" className="px-3 py-2 rounded border border-[#1b2344] disabled:opacity-50" disabled={!courseFilter || !tplStart}
              onClick={async () => {
                if (!courseFilter || !tplStart) return;
                let tpl: any[] = [];
                try { tpl = JSON.parse(window.localStorage.getItem(`courseTemplate:${courseFilter.toLowerCase()}`) || '[]'); } catch {}
                if (!tpl.length) return;
                const start = new Date(tplStart);
                const step = Math.max(1, parseInt(tplStepDays || '1', 10));
                const payload = tpl.map((x, i) => {
                  const d = new Date(start); d.setDate(d.getDate() + i * step); d.setHours(23,59,59,999);
                  return { title: x.title, course: x.course || courseFilter, dueDate: d.toISOString(), status: 'todo', estimatedMinutes: x.estimatedMinutes ?? null, priority: x.priority ?? null, tags: x.tags ?? [], term: currentTerm || null };
                });
                try {
                  const res = await fetch('/api/tasks/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: payload }) });
                  if (res.ok) {
                    await refresh();
                  }
                } catch {}
              }}>Apply template</button>
          </div>
        </div>
      </div>
      {importOpen && (
        <MultiAddDrawer onCreated={refresh} />
      )}
      <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2">
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
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Tag contains</label>
          <input value={tagFilter} onChange={e => setTagFilter(e.target.value)} placeholder="e.g., outline" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Text search</label>
          <input value={textFilter} onChange={e => setTextFilter(e.target.value)} placeholder="title contains…" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 border border-[#1b2344] rounded p-3 bg-[#0b1020]">
          <div className="text-xs text-slate-300/70 mb-2">Bulk actions · {selected.size} selected</div>
          <div className="flex flex-wrap gap-2 items-end">
            <button onClick={() => bulkPatch(() => ({ status: 'done' }))} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs">Mark done</button>
            <button onClick={() => bulkPatch(() => ({ status: 'todo' }))} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Mark todo</button>
            <button onClick={bulkDelete} className="px-2 py-1 rounded border border-rose-600 text-rose-400 text-xs">Delete</button>
            <div className="flex items-center gap-1">
              <label className="text-xs" htmlFor="bulk-due">Due</label>
              <input id="bulk-due" type="date" value={bulkDue} onChange={e=>setBulkDue(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" />
              <button onClick={() => bulkPatch(() => (bulkDue ? { dueDate: new Date(`${bulkDue}T23:59:59`).toISOString() } : null))} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Apply</button>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs" htmlFor="bulk-course">Course</label>
              <input id="bulk-course" value={bulkCourse} onChange={e=>setBulkCourse(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" />
              <button onClick={() => bulkPatch(() => ({ course: bulkCourse.trim() || null }))} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Apply</button>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs" htmlFor="bulk-addtag">Add tag</label>
              <input id="bulk-addtag" value={bulkAddTag} onChange={e=>setBulkAddTag(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" />
              <button onClick={() => bulkPatch((t) => {
                const tg = bulkAddTag.trim(); if (!tg) return null;
                const cur = (t.tags || []).slice(); if (!cur.map(x=>x.toLowerCase()).includes(tg.toLowerCase())) cur.push(tg);
                return { tags: cur };
              })} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Apply</button>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs" htmlFor="bulk-removetag">Remove tag</label>
              <input id="bulk-removetag" value={bulkRemoveTag} onChange={e=>setBulkRemoveTag(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" />
              <button onClick={() => bulkPatch((t) => {
                const tg = bulkRemoveTag.trim(); if (!tg) return null;
                const next = (t.tags || []).filter(x => x.toLowerCase() !== tg.toLowerCase());
                return { tags: next };
              })} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Apply</button>
              <button onClick={() => bulkPatch((t) => ({ tags: (t.tags || []).filter(x => x.toLowerCase() !== 'inbox') }))} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Clear Inbox</button>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs" htmlFor="bulk-pri">Pri</label>
              <input id="bulk-pri" type="number" min={1} max={5} value={bulkPriority} onChange={e=>setBulkPriority(e.target.value)} className="w-16 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" />
              <button onClick={() => {
                const n = parseInt(bulkPriority || '0', 10); if (!n || n<1||n>5) return;
                bulkPatch(() => ({ priority: n }));
              }} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Apply</button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <p className="text-sm">Loading...</p>
      ) : (filteredTasks.length === 0 && tasks.length > 0) ? (
        <p className="text-sm text-slate-300/80">No matching tasks. Adjust filters.</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-slate-300/80">No tasks yet. Use Quick Add above to capture items.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-2 pr-2 hidden sm:table-cell"><input type="checkbox" aria-label="Select all" checked={allSelected && filteredTasks.length>0} onChange={toggleSelectAll} /></th>
                <th className="py-2 pr-4">Course</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4 hidden lg:table-cell">Activity</th>
                <th className="py-2 pr-4 hidden md:table-cell">Pages</th>
                <th className="py-2 pr-4">Due</th>
                <th className="py-2 pr-4 hidden sm:table-cell">Est.</th>
                <th className="py-2 pr-4 hidden md:table-cell">Focus</th>
                <th className="py-2 pr-4 hidden lg:table-cell">Pri</th>
                <th className="py-2 pr-4 hidden lg:table-cell">Tags</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map(t => (
                <tr key={t.id} className="border-t border-[#1b2344]">
                  <td className="py-2 pr-2 hidden sm:table-cell"><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                  <td className="py-2 pr-4">
                    {editingId === t.id ? (
                      <input value={editCourse} onChange={e => setEditCourse(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      <div className="flex items-center gap-2">
                        {(() => { const dc = displayCourseForTask(t); return dc ? <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorForCourse(dc) }}></span> : null; })()}
                        <span>{displayCourseForTask(t) || '-'}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[280px]">
                    {editingId === t.id ? (
                      <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      <span className="break-words">{sanitizeTitle(t.title || '')}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 hidden lg:table-cell">{(t.activity||'') ? (t.activity as string) : '-'}</td>
                  <td className="py-2 pr-4 hidden md:table-cell">{typeof (t.pagesRead as any) === 'number' ? (t.pagesRead as any) : '-'}</td>
                  <td
                    className="py-2 pr-4 whitespace-nowrap"
                    onDoubleClick={() => {
                      startEdit(t);
                      setTimeout(() => {
                        try { (dueInputRef.current as any)?.showPicker?.(); dueInputRef.current?.focus(); } catch {}
                      }, 0);
                    }}
                  >
                    {editingId === t.id ? (
                      <input ref={dueInputRef} type="datetime-local" value={editDue} onChange={e => setEditDue(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      new Date(t.dueDate).toLocaleString()
                    )}
                  </td>
                  <td className="py-2 pr-4 hidden sm:table-cell">
                    {editingId === t.id ? (
                      <input type="number" min={0} step={5} value={editEst} onChange={e => setEditEst(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      (t.estimatedMinutes != null ? fmtHM(t.estimatedMinutes) : '-')
                    )}
                  </td>
                  <td className="py-2 pr-4 hidden md:table-cell">
                    {(() => {
                      const avg = focusAvgByTask[t.id];
                      if (!avg) return <span className="text-slate-500">-</span>;
                      const color = avg >= 8 ? 'text-emerald-400' : avg >= 6 ? 'text-blue-400' : avg >= 4 ? 'text-amber-400' : 'text-rose-400';
                      return <span className={color}>{avg.toFixed(1)}</span>;
                    })()}
                  </td>
                  <td className="py-2 pr-4 hidden lg:table-cell">
                    {editingId === t.id ? (
                      <input type="number" min={1} max={5} value={editPriority} onChange={e => setEditPriority(e.target.value)} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      t.priority ?? '-'
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[220px] hidden lg:table-cell">
                    {editingId === t.id ? (
                      <input value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="Comma-separated tags" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (
                      (t.tags && t.tags.length > 0) ? (
                        <div className="flex gap-1 flex-wrap">
                          {t.tags.map((tg, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1b2344]">{tg}</span>
                          ))}
                        </div>
                      ) : '-'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${t.status === 'done' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-blue-900/40 text-blue-400'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === t.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={saveEdit} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">Save</button>
                        <button onClick={cancelEdit} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEdit(t)} className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-white/5">Edit</button>
                          <button onClick={() => toggleDone(t)} className={`px-2 py-1 rounded text-xs ${t.status === 'done' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>{t.status === 'done' ? 'Undo' : 'Done'}</button>
                          <button onClick={() => remove(t.id)} className="px-2 py-1 rounded bg-rose-600/80 hover:bg-rose-500 text-xs">Del</button>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-300/70">
                          <span>{fmtHM(Math.round(elapsedMs(t.id)/60000))}</span>
                          {timers[t.id]?.running ? (
                            <button onClick={() => pauseTimerFor(t.id)} className="px-1.5 py-0.5 rounded border border-amber-600/50 text-amber-400 text-[10px]">Pause</button>
                          ) : (
                            <button onClick={() => startTimerFor(t.id)} className="px-1.5 py-0.5 rounded border border-emerald-600/50 text-emerald-400 text-[10px]">Start</button>
                          )}
                          <button onClick={() => clearTimerFor(t.id)} className="px-1.5 py-0.5 rounded border border-[#1b2344] text-[10px]">Clear</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Log Modal for task completion */}
      <LogModal
        isOpen={logModalOpen}
        onClose={() => { setLogModalOpen(false); setLogModalTask(null); }}
        onSubmit={handleLogSubmit}
        task={logModalTask}
        mode={logModalMode}
        defaultMinutes={logModalTask ? Math.round(elapsedMs(logModalTask.id) / 60000) || undefined : undefined}
      />
      
      {/* Undo Toast */}
      {showUndo && undoStack.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl px-4 py-3 flex items-center gap-4 animate-in slide-in-from-bottom duration-200">
          <span className="text-sm">
            {undoStack[undoStack.length - 1]?.type === 'delete' ? 'Task deleted' : 'Task updated'}
          </span>
          <button
            onClick={undoLast}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium"
          >
            Undo
          </button>
          <button
            onClick={() => setShowUndo(false)}
            className="text-slate-400 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
      
      {/* Edit Task Modal */}
      {editModalOpen && editModalTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeEditModal}>
          <div className="bg-[#11162b] border border-[#1b2344] rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold">Edit Task</h3>
                <button onClick={closeEditModal} className="text-slate-400 hover:text-white text-xl">×</button>
              </div>
              
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                
                {/* Course & Activity Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Course</label>
                    <input
                      type="text"
                      value={editCourse}
                      onChange={e => setEditCourse(e.target.value)}
                      placeholder="e.g., Contracts"
                      className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Activity</label>
                    <select
                      value={editActivity}
                      onChange={e => setEditActivity(e.target.value)}
                      className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select...</option>
                      <option value="reading">Reading</option>
                      <option value="assignment">Assignment</option>
                      <option value="outline">Outline</option>
                      <option value="review">Review</option>
                      <option value="practice">Practice</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                
                {/* Pages & Estimate Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Pages</label>
                    <input
                      type="number"
                      min={0}
                      value={editPages}
                      onChange={e => setEditPages(e.target.value)}
                      placeholder="Number of pages"
                      className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Estimate (minutes)</label>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={editEst}
                      onChange={e => setEditEst(e.target.value)}
                      placeholder="e.g., 60"
                      className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                
                {/* Due Date & Priority Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Due Date</label>
                    <input
                      type="datetime-local"
                      value={editDue}
                      onChange={e => setEditDue(e.target.value)}
                      className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Priority (1-5)</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={editPriority}
                      onChange={e => setEditPriority(e.target.value)}
                      placeholder="1 = highest"
                      className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                
                {/* Tags */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    placeholder="e.g., exam-prep, important"
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                
                {/* Notes */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Notes</label>
                  <textarea
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    rows={3}
                    placeholder="Additional notes..."
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
                  />
                </div>
              </div>
              
              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#1b2344]">
                <button
                  onClick={closeEditModal}
                  className="px-4 py-2 rounded-lg border border-[#1b2344] text-sm hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEditModal}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
