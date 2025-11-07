"use client";
import { useEffect, useMemo, useState } from "react";

type BacklogItem = {
  id: string;
  title: string;
  course: string;
  dueDate?: string | null;
  pages?: number | null;
  estimatedMinutes?: number | null;
  priority?: number | null;
  tags?: string[] | null;
};

const LS_BACKLOG = "backlogItemsV1";

function uid(): string {
  if ((globalThis as any).crypto?.randomUUID) return (globalThis as any).crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function minutesPerPage(): number {
  if (typeof window === "undefined") return 3;
  const s = window.localStorage.getItem("minutesPerPage");
  const n = s ? parseFloat(s) : NaN;
  return !isNaN(n) && n > 0 ? n : 3;
}

function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = f.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const da = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${da}`;
}

function nextDowYmd(token: string): string | null {
  const map: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  const k = token.trim().toLowerCase();
  if (!(k in map)) return null;
  const target = map[k];
  const now = new Date();
  const parts = chicagoYmd(now).split("-").map((x) => parseInt(x, 10));
  const base = new Date(parts[0], (parts[1] as number) - 1, parts[2]);
  const dow = base.getDay();
  let delta = (target - dow + 7) % 7;
  if (delta === 0) delta = 7;
  const out = new Date(base);
  out.setDate(out.getDate() + delta);
  return chicagoYmd(out);
}

function loadBacklog(): BacklogItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_BACKLOG);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveBacklog(items: BacklogItem[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(LS_BACKLOG, JSON.stringify(items));
}

function parseQuickAdd(input: string): Omit<BacklogItem, "id"> | null {
  const s = (input || "").trim();
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
  const estimatedMinutes = pages && pages > 0 ? Math.round(pages * minutesPerPage()) : null;
  const title = rest.trim();
  if (!title) return null;
  return { title, course, dueDate, pages: pages ?? null, estimatedMinutes, priority: null, tags: null };
}

export default function BacklogPage() {
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [filter, setFilter] = useState<string>("All");
  const [qaInput, setQaInput] = useState("");
  const [qaError, setQaError] = useState("");

  const [form, setForm] = useState({
    title: "",
    course: "",
    dueDate: "",
    pages: "",
    estimatedMinutes: "",
    priority: "",
    tags: "",
  });

  useEffect(() => { setItems(loadBacklog()); }, []);
  useEffect(() => { saveBacklog(items); }, [items]);

  const courses = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.course) set.add(it.course);
    return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filtered = useMemo(() => {
    const arr = (items || []).filter((it) => filter === "All" || it.course === filter);
    arr.sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      const ap = a.priority ?? 0;
      const bp = b.priority ?? 0;
      return bp - ap;
    });
    return arr;
  }, [items, filter]);

  function addQuick() {
    setQaError("");
    const parsed = parseQuickAdd(qaInput);
    if (!parsed) { setQaError("Could not parse. Use: COURSE: Title (24p) – due Fri"); return; }
    const it: BacklogItem = { id: uid(), ...parsed };
    setItems((prev) => [it, ...prev]);
    setQaInput("");
  }

  function addManual(e: React.FormEvent) {
    e.preventDefault();
    const title = form.title.trim();
    const course = form.course.trim();
    if (!title || !course) return;
    const pages = form.pages ? Math.max(0, parseInt(form.pages, 10) || 0) : null;
    let est = form.estimatedMinutes ? Math.max(0, parseInt(form.estimatedMinutes, 10) || 0) : null;
    if ((!est || est === 0) && pages && pages > 0) est = Math.round(pages * minutesPerPage());
    const pri = form.priority ? Math.max(1, Math.min(5, parseInt(form.priority, 10) || 0)) : null;
    const tags = form.tags.trim() ? form.tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean) : null;
    const dueDate = form.dueDate ? form.dueDate : null;
    const it: BacklogItem = { id: uid(), title, course, dueDate, pages, estimatedMinutes: est, priority: pri, tags };
    setItems((prev) => [it, ...prev]);
    setForm({ title: "", course: "", dueDate: "", pages: "", estimatedMinutes: "", priority: "", tags: "" });
  }

  function removeItem(id: string) { setItems((prev) => prev.filter((x) => x.id !== id)); }
  function updatePriority(id: string, val: number) { setItems((prev) => prev.map((x) => (x.id === id ? { ...x, priority: Math.max(1, Math.min(5, Math.floor(val))) } : x))); }
  function updateDueDate(id: string, ymd: string) { setItems((prev) => prev.map((x) => (x.id === id ? { ...x, dueDate: ymd || null } : x))); }

  return (
    <main className="space-y-6">
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Backlog Intake</h2>
          <p className="text-sm text-slate-300/70">Capture readings and assignments, fast. Parser supports “Course: Title (24p) – due Fri”.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Quick Add</h3>
            <label htmlFor="qa-input" className="sr-only">Quick add input</label>
            <input
              id="qa-input"
              value={qaInput}
              onChange={(e) => setQaInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addQuick(); }}
              className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              placeholder="T&E: Read 599–622 (24p) – due Fri"
              aria-describedby="qa-examples"
            />
            <div className="flex items-center gap-2">
              <button onClick={addQuick} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Add</button>
              {qaError && <div className="text-xs text-rose-400" role="alert" aria-live="polite">{qaError}</div>}
            </div>
            <div id="qa-examples" className="text-xs text-slate-300/60">
              Examples: "IP: Outline update – due Tue", "AMSL: Problem 10-2 (10p) – due Thu"
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Manual Add</h3>
            <form onSubmit={addManual} className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs mb-1" htmlFor="f-course">Course</label>
                  <input id="f-course" value={form.course} onChange={(e)=>setForm(f=>({...f,course:e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" required />
                </div>
                <div>
                  <label className="block text-xs mb-1" htmlFor="f-due">Due Date</label>
                  <input id="f-due" type="date" value={form.dueDate} onChange={(e)=>setForm(f=>({...f,dueDate:e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1" htmlFor="f-title">Title</label>
                <input id="f-title" value={form.title} onChange={(e)=>setForm(f=>({...f,title:e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" required />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs mb-1" htmlFor="f-pages">Pages</label>
                  <input id="f-pages" type="number" min={0} value={form.pages} onChange={(e)=>setForm(f=>({...f,pages:e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                </div>
                <div>
                  <label className="block text-xs mb-1" htmlFor="f-est">Est. Minutes</label>
                  <input id="f-est" type="number" min={0} value={form.estimatedMinutes} onChange={(e)=>setForm(f=>({...f,estimatedMinutes:e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                </div>
                <div>
                  <label className="block text-xs mb-1" htmlFor="f-pri">Priority (1–5)</label>
                  <input id="f-pri" type="number" min={1} max={5} value={form.priority} onChange={(e)=>setForm(f=>({...f,priority:e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1" htmlFor="f-tags">Tags</label>
                <input id="f-tags" value={form.tags} onChange={(e)=>setForm(f=>({...f,tags:e.target.value}))} placeholder="comma or space separated" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
              </div>
              <div>
                <button type="submit" className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Add Item</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Backlog Items</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-300/60" htmlFor="course-filter">Course</label>
            <select id="course-filter" value={filter} onChange={(e)=>setFilter(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
              {courses.map(c => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>
        <div className="min-h-[140px]">
          {filtered.length === 0 ? (
            <div className="text-sm text-slate-300/80">No backlog items yet. Try “T&E: Read 599–622 (24p) – due Fri”.</div>
          ) : (
            <ul className="divide-y divide-[#1b2344]">
              {filtered.map(it => (
                <li key={it.id} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 truncate">{it.course ? `${it.course}: ` : ''}{it.title}</div>
                    <div className="text-xs text-slate-300/70">
                      {it.dueDate ? `Due ${new Date(it.dueDate).toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric' })}` : 'No due date'}
                      {typeof it.pages === 'number' && it.pages>0 ? ` · ${it.pages}p` : ''}
                      {typeof it.estimatedMinutes === 'number' && it.estimatedMinutes>0 ? ` · ~${it.estimatedMinutes}m` : ''}
                      {typeof it.priority === 'number' ? ` · P${it.priority}` : ''}
                      {Array.isArray(it.tags) && it.tags.length ? ` · ${it.tags.join(', ')}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`due-${it.id}`}>Due date for {it.title}</label>
                    <input id={`due-${it.id}`} type="date" value={it.dueDate || ''} onChange={(e)=>updateDueDate(it.id, e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                    <label className="sr-only" htmlFor={`pri-${it.id}`}>Priority for {it.title}</label>
                    <input id={`pri-${it.id}`} type="number" min={1} max={5} value={it.priority ?? ''} onChange={(e)=>updatePriority(it.id, parseInt(e.target.value||'0',10)||0)} placeholder="P" className="w-16 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                    <button onClick={()=>removeItem(it.id)} className="px-2 py-1 rounded border border-rose-600 text-rose-400 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
