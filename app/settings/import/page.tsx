"use client";
import { useEffect, useState } from "react";

type MapKey =
  | "ignore"
  | "date"
  | "course"
  | "taskType"
  | "hours"
  | "focus"
  | "notes"
  | "pagesRead"
  | "outlinePages"
  | "practiceQuestions"
  | "internshipTime";

type PreviewRow = {
  idx: number;
  values: string[];
  parsed?: Parsed;
  invalidReason?: string;
  duplicate?: boolean;
};

type Parsed = {
  whenISO: string; // ISO
  course: string;
  minutes: number; // >=0
  focus: number | null;
  notes: string | null;
  pagesRead: number;
  outlinePages: number;
  practiceQs: number;
  taskType: string; // normalized
  internshipMinutes: number; // >=0
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(field.trim()); field = ""; }
      else if (ch === '\n') { cur.push(field.trim()); rows.push(cur); cur = []; field = ""; }
      else if (ch === '\r') { /* ignore */ }
      else { field += ch; }
    }
  }
  if (inQuotes) { /* unbalanced quotes; still flush */ }
  if (field.length || cur.length) { cur.push(field.trim()); rows.push(cur); }
  return rows.filter(r => r.some(v => v.length > 0));
}

function guessMap(headers: string[]): Record<number, MapKey> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const m: Record<number, MapKey> = {} as any;
  headers.forEach((h, i) => {
    const n = norm(h);
    if (/^date$/.test(n) || /\bdate\b/.test(n)) m[i] = "date";
    else if (/^course$/.test(n) || /\b(class|subject)\b/.test(n)) m[i] = "course";
    else if (/task type|^type$/.test(n)) m[i] = "taskType";
    else if (/^hours?$/.test(n) || /\bhours\b/.test(n)) m[i] = "hours";
    else if (/focus/.test(n)) m[i] = "focus";
    else if (/^notes?$/.test(n) || /comment/.test(n)) m[i] = "notes";
    else if (/pages? read/.test(n)) m[i] = "pagesRead";
    else if (/outline pages?/.test(n)) m[i] = "outlinePages";
    else if (/practice(\s|\-)?(qs|questions)/.test(n)) m[i] = "practiceQuestions";
    else if (/internship/.test(n)) m[i] = "internshipTime";
    else m[i] = "ignore";
  });
  return m;
}

function normalizeTaskType(s: string): string {
  const n = (s || "").toLowerCase().trim();
  if (/read/.test(n)) return "Reading";
  if (/review/.test(n)) return "Review";
  if (/outline/.test(n)) return "Outline";
  if (/practice/.test(n)) return "Practice";
  if (/intern/.test(n)) return "Internship";
  if (!n) return "Other";
  return ["reading","review","outline","practice","internship","other"].includes(n) ? n[0].toUpperCase() + n.slice(1) : "Other";
}

function toActivity(taskType: string): string {
  switch (taskType) {
    case "Reading": return "reading";
    case "Review": return "review";
    case "Outline": return "outline";
    case "Practice": return "practice";
    case "Internship": return "internship";
    default: return "other";
  }
}

function extractCourseFromNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  const m = notes.match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : '';
}

function parseUsDate(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  const yyyy = parseInt(m[3].length === 2 ? ("20" + m[3]) : m[3], 10);
  if (isNaN(mm) || isNaN(dd) || isNaN(yyyy)) return null;
  const d = new Date(yyyy, mm - 1, dd, 20, 0, 0, 0); // 8pm local to be TZ-safe
  return isNaN(d.getTime()) ? null : d;
}

async function sha1Hex(str: string): Promise<string> {
  if ((globalThis as any).crypto?.subtle) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-1", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // djb2 fallback
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) + str.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

export default function ImportCsvPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, MapKey>>({});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [dedup, setDedup] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("");
  const [summary, setSummary] = useState<{ imported: number; duplicates: number; invalid: number } | null>(null);

  useEffect(() => {
    async function seed() {
      try {
        const res = await fetch('/api/sessions', { cache: 'no-store' });
        const data = await res.json();
        const set = new Set<string>();
        for (const s of (data.sessions || [])) {
          const taskType = (() => {
            const a = (s.activity || '').toLowerCase();
            if (a === 'reading') return 'Reading';
            if (a === 'review') return 'Review';
            if (a === 'outline') return 'Outline';
            if (a === 'practice') return 'Practice';
            if (a === 'internship') return 'Internship';
            return 'Other';
          })();
          const date = new Date(s.when);
          const ymd = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
          const seedCourse = extractCourseFromNotes(s.notes);
          const seedNotes = s.notes ? s.notes.replace(/^\s*\[[^\]]+\]\s*/, '') : '';
          const key = `${ymd}|${seedCourse}|${s.minutes || 0}|${s.focus ?? ''}|${seedNotes}|${s.pagesRead || 0}|${s.outlinePages || 0}|${s.practiceQs || 0}|${taskType}`;
          set.add(await sha1Hex(key));
        }
        const stored = (typeof window !== 'undefined') ? (window.localStorage.getItem('sessionDedupSet') || '') : '';
        if (stored) {
          try { JSON.parse(stored).forEach((h: string) => set.add(h)); } catch {}
        }
        setDedup(set);
      } catch {}
    }
    seed();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('sessionDedupSet', JSON.stringify(Array.from(dedup)));
  }, [dedup]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || "");
      const data = parseCsv(text);
      if (!data.length) { setHeaders([]); setRows([]); setMapping({}); setPreview([]); return; }
      const hdr = data[0];
      setHeaders(hdr);
      const body = data.slice(1);
      setRows(body);
      const m = guessMap(hdr);
      setMapping(m);
      await buildPreview(body, m, 25);
    };
    reader.readAsText(f);
  }

  function setMapFor(colIdx: number, key: MapKey) {
    const m = { ...mapping, [colIdx]: key };
    setMapping(m);
    buildPreview(rows, m, 25);
  }

  function coerceParsed(vals: string[], m: Record<number, MapKey>): Parsed | { error: string } {
    const get = (k: MapKey): string => {
      for (const [iStr, v] of Object.entries(m)) if (v === k) return vals[parseInt(iStr, 10)] || '';
      return '';
    };
    const dateStr = get('date');
    const course = get('course').trim();
    const typeRaw = get('taskType');
    const hoursStr = get('hours');
    const focusStr = get('focus');
    const notesStr = get('notes');
    const pagesStr = get('pagesRead');
    const outlineStr = get('outlinePages');
    const practiceStr = get('practiceQuestions');
    const internStr = get('internshipTime');

    const d = parseUsDate(dateStr);
    if (!d) return { error: 'Invalid date' };
    const whenISO = d.toISOString();

    const minutes = (() => {
      const n = parseFloat(hoursStr || '0');
      if (!isNaN(n) && n > 0) return Math.round(n * 60);
      return 0;
    })();

    let focus: number | null = null;
    if (focusStr && focusStr.trim().length > 0) {
      const f = Math.max(0, Math.min(10, parseFloat(focusStr)));
      focus = Math.round(f);
      if (focus <= 0) focus = null;
    }

    const pagesRead = Math.max(0, parseInt(pagesStr || '0', 10) || 0);
    const outlinePages = Math.max(0, parseInt(outlineStr || '0', 10) || 0);
    const practiceQs = Math.max(0, parseInt(practiceStr || '0', 10) || 0);

    const internshipMinutes = (() => {
      const n = parseFloat(internStr || '0');
      if (!isNaN(n) && n > 0) return Math.round(n * 60);
      return 0;
    })();

    const taskType = normalizeTaskType(typeRaw);

    const parsed: Parsed = {
      whenISO,
      course,
      minutes,
      focus,
      notes: notesStr ? notesStr : null,
      pagesRead,
      outlinePages,
      practiceQs,
      taskType,
      internshipMinutes,
    };
    if (!parsed.course) return { error: 'Missing course' };
    if (!(parsed.minutes > 0 || parsed.pagesRead > 0 || parsed.outlinePages > 0 || parsed.practiceQs > 0)) return { error: 'No effort values' };
    return parsed;
  }

  async function buildPreview(allRows: string[][], m: Record<number, MapKey>, cap: number) {
    const out: PreviewRow[] = [];
    const first = allRows.slice(0, cap);
    for (let i = 0; i < first.length; i++) {
      const vals = first[i];
      const p = coerceParsed(vals, m);
      if ('error' in p) {
        out.push({ idx: i, values: vals, invalidReason: p.error });
      } else {
        const taskKey = `${p.whenISO.slice(0,10)}|${p.course}|${p.minutes}|${p.focus ?? ''}|${p.notes || ''}|${p.pagesRead}|${p.outlinePages}|${p.practiceQs}|${p.taskType}`;
        const h = await sha1Hex(taskKey);
        out.push({ idx: i, values: vals, parsed: p, duplicate: dedup.has(h) });
      }
    }
    setPreview(out);
  }

  async function importRows(mode: 'append' | 'replace') {
    if (!rows.length) return;
    setStatus(mode === 'replace' ? 'Resetting sessions…' : 'Importing…');
    setSummary(null);
    try {
      let imported = 0, duplicates = 0, invalid = 0;
      if (mode === 'replace') {
        const r = await fetch('/api/sessions/reset', { method: 'POST' });
        if (!r.ok) throw new Error('Failed to reset sessions');
        setDedup(new Set());
      }
      for (let i = 0; i < rows.length; i++) {
        const vals = rows[i];
        const res = coerceParsed(vals, mapping);
        if ('error' in res) { invalid++; continue; }
        const p = res as Parsed;
        const entries: Array<Parsed> = [p];
        if (p.internshipMinutes > 0) {
          entries.push({ ...p, course: 'Internship', taskType: 'Internship', minutes: p.internshipMinutes });
        }
        for (const e of entries) {
          const key = `${e.whenISO.slice(0,10)}|${e.course}|${e.minutes}|${e.focus ?? ''}|${e.notes || ''}|${e.pagesRead}|${e.outlinePages}|${e.practiceQs}|${e.taskType}`;
          const h = await sha1Hex(key);
          if (dedup.has(h)) { duplicates++; continue; }
          const body: any = {
            when: e.whenISO,
            minutes: e.minutes,
            focus: e.focus ?? null,
            notes: e.notes ?? null,
            pagesRead: e.pagesRead || null,
            outlinePages: e.outlinePages || null,
            practiceQs: e.practiceQs || null,
            activity: toActivity(e.taskType),
          };
          if (e.course) {
            body.notes = body.notes ? `[${e.course}] ${body.notes}` : `[${e.course}]`;
          }
          const resp = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (resp.ok) {
            imported++;
            setDedup(prev => new Set(prev).add(h));
          } else {
            invalid++;
          }
        }
      }
      setSummary({ imported, duplicates, invalid });
      setStatus('Done.');
    } catch (e: any) {
      setStatus(`Import failed: ${e?.message || e}`);
    }
  }

  async function exportCsv() {
    try {
      setStatus('Exporting…');
      const [sRes, tRes] = await Promise.all([
        fetch('/api/sessions', { cache: 'no-store' }).catch(() => null),
        fetch('/api/tasks', { cache: 'no-store' }).catch(() => null),
      ]);
      const sessions: any[] = (sRes && sRes.ok) ? ((await sRes!.json())?.sessions || []) : [];
      const tasks: any[] = (tRes && tRes.ok) ? ((await tRes!.json())?.tasks || []) : [];
      const taskById = new Map<string, any>();
      for (const t of tasks) if (t && t.id) taskById.set(t.id, t);

      const headers = ['Date','Course','Task Type','Hours','Focus','Notes','Pages Read','Outline Pages','Practice Qs','Internship Time'];
      const taskTypeFromActivity = (a: string | null | undefined): string => {
        const x = (a || '').toLowerCase();
        if (x === 'reading') return 'Reading';
        if (x === 'review') return 'Review';
        if (x === 'outline') return 'Outline';
        if (x === 'practice') return 'Practice';
        if (x === 'internship') return 'Internship';
        return 'Other';
      };
      const stripCoursePrefix = (notes: string | null | undefined): string => {
        if (!notes) return '';
        return notes.replace(/^\s*\[[^\]]+\]\s*/, '');
      };
      const fmtUsDate = (iso: string): string => {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US');
      };
      const hoursFromMinutes = (m: any): string => {
        const n = Math.max(0, Number(m) || 0);
        return (n / 60).toFixed(3);
      };
      const csvEscape = (s: any): string => {
        const str = String(s ?? '');
        if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
        return str;
      };

      const lines: string[] = [];
      lines.push(headers.join(','));
      for (const s of sessions) {
        const t = s.taskId ? taskById.get(s.taskId) : null;
        const course = ((s.activity || '').toLowerCase() === 'internship') ? 'Internship' : (t?.course || extractCourseFromNotes(s.notes) || '');
        const fields = [
          fmtUsDate(s.when),
          course,
          taskTypeFromActivity(s.activity),
          hoursFromMinutes(s.minutes),
          (s.focus == null ? '' : String(s.focus)),
          stripCoursePrefix(s.notes),
          s.pagesRead ?? '',
          s.outlinePages ?? '',
          s.practiceQs ?? '',
          '',
        ].map(csvEscape);
        lines.push(fields.join(','));
      }

      const csv = lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0,10);
      a.href = url;
      a.download = `sessions-${today}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('Export ready.');
    } catch (e: any) {
      setStatus(`Export failed: ${e?.message || e}`);
    } finally {
      setTimeout(() => setStatus(''), 800);
    }
  }

  const mapKeys: Array<{ key: MapKey; label: string }> = [
    { key: 'ignore', label: 'Ignore' },
    { key: 'date', label: 'Date' },
    { key: 'course', label: 'Course' },
    { key: 'taskType', label: 'Task Type' },
    { key: 'hours', label: 'Hours' },
    { key: 'focus', label: 'Focus' },
    { key: 'notes', label: 'Notes' },
    { key: 'pagesRead', label: 'Pages Read' },
    { key: 'outlinePages', label: 'Outline Pages' },
    { key: 'practiceQuestions', label: 'Practice Qs' },
    { key: 'internshipTime', label: 'Internship Time' },
  ];

  return (
    <main className="space-y-6">
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Import Data (CSV)</h2>
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
            <button onClick={exportCsv} className="px-3 py-2 rounded border border-[#1b2344] text-sm">Export Sessions (.csv)</button>
          </div>
        </div>
        {headers.length > 0 && (
          <div className="overflow-x-auto">
            <div className="text-xs text-slate-300/70 mb-2">Column mapping</div>
            <div className="min-w-[640px]">
              <div className="grid" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(120px, 1fr))` }}>
                {headers.map((h, i) => (
                  <div key={i} className="p-2 border border-[#1b2344]">
                    <div className="text-[11px] text-slate-300/60 mb-1 truncate" title={h}>{h}</div>
                    <select value={mapping[i] || 'ignore'} onChange={e => setMapFor(i, e.target.value as MapKey)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm">
                      {mapKeys.map(opt => (<option key={opt.key} value={opt.key}>{opt.label}</option>))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {preview.length > 0 && (
        <section className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Preview (first 25 rows)</div>
            <div className="flex items-center gap-2">
              <button onClick={() => importRows('append')} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm">Append</button>
              <button onClick={() => importRows('replace')} className="px-3 py-2 rounded border border-rose-600 text-rose-400 text-sm">Replace all sessions</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-300/60">
                <tr>
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Course</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Minutes</th>
                  <th className="py-1 pr-2">Focus</th>
                  <th className="py-1 pr-2">Pages</th>
                  <th className="py-1 pr-2">Outline</th>
                  <th className="py-1 pr-2">Practice</th>
                  <th className="py-1 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.idx} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.idx + 1}</td>
                    <td className="py-1 pr-2">{r.parsed ? new Date(r.parsed.whenISO).toLocaleDateString() : '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.course || '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.taskType || '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.minutes ?? '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.focus ?? '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.pagesRead ?? '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.outlinePages ?? '—'}</td>
                    <td className="py-1 pr-2">{r.parsed?.practiceQs ?? '—'}</td>
                    <td className="py-1 pr-2">
                      {r.invalidReason ? <span className="text-rose-400 text-xs">Invalid: {r.invalidReason}</span> : r.duplicate ? <span className="text-amber-400 text-xs">Duplicate</span> : <span className="text-emerald-400 text-xs">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status && <div className="text-xs text-slate-300/70">{status}</div>}
          {summary && (
            <div className="text-xs text-slate-300/70">Imported: {summary.imported} · Duplicates: {summary.duplicates} · Invalid: {summary.invalid}</div>
          )}
        </section>
      )}
    </main>
  );
}
