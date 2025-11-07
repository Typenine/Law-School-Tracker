"use client";
import { useState, useEffect } from 'react';

export default function WizardPreviewPage() {
  const [file, setFile] = useState<File | null>(null);
  const [course, setCourse] = useState('');
  const [tz, setTz] = useState('America/Chicago');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);

  async function onUpload() {
    if (!file) return;
    setLoading(true); setError(null); setData(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (course) fd.append('course', course);
      if (tz) fd.append('timezone', tz);
      const res = await fetch('/api/wizard/preview', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Import Wizard (Preview)</h1>
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Course (optional)</label>
            <input value={course} onChange={e => setCourse(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm mb-1">Timezone</label>
            <input value={tz} onChange={e => setTz(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <p className="text-xs text-slate-300/70 mt-1">Default America/Chicago</p>
          </div>
          <div>
            <label className="block text-sm mb-1">Source file</label>
            <input type="file" accept=".pdf,.docx,.txt" onChange={e => setFile(e.target.files?.[0] || null)} className="w-full" />
          </div>
        </div>
        <div>
          <button onClick={onUpload} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50" disabled={!file || loading}>{loading ? 'Processing…' : 'Preview'}</button>
        </div>
        {error && <div className="text-sm text-rose-400">{error}</div>}
      </div>
      {data && (
        <>
          <div className="card p-4">
            <h2 className="text-lg font-medium mb-2">Prep Preview</h2>
            <div className="text-sm text-slate-300/80 mb-2">Detected course meta and quick parse. Proceed to Mapping to teach the system your table columns.</div>
            <pre className="text-[11px] whitespace-pre-wrap bg-[#0b1020] border border-[#1b2344] rounded p-2">{JSON.stringify(data.preview, null, 2)}</pre>
          </div>

          <MappingPanel data={data} tz={tz} />
        </>
      )}
    </main>
  );
}

function MappingPanel({ data, tz }: { data: any; tz: string }) {
  const [dateCol, setDateCol] = useState<number>(0);
  const [topicCol, setTopicCol] = useState<number>(1);
  const [readingsCol, setReadingsCol] = useState<number>(1);
  const [assignCol, setAssignCol] = useState<number>(1);
  const [mapped, setMapped] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: string[][] = (data?.tables || []).flatMap((t: any) => t?.rows || []);
  const sample = rows.slice(0, 8);
  const maxCols = sample.reduce((m: number, r: string[]) => Math.max(m, r.length), 0);
  const options = Array.from({ length: maxCols }, (_, i) => i);

  // Initialize sensible defaults once we know column count
  const [init, setInit] = useState(false);
  useEffect(() => {
    if (init) return;
    if (maxCols > 0) {
      setDateCol(0);
      const right = Math.max(0, maxCols - 1);
      setTopicCol(right);
      setReadingsCol(right);
      setAssignCol(right);
      setInit(true);
    }
  }, [maxCols, init]);

  async function applyMapping() {
    setLoading(true); setError(null); setMapped(null);
    try {
      const body = JSON.stringify({
        rows,
        mapping: { dateCol, topicCol, readingsCol, assignmentsCol: assignCol },
        timezone: tz,
        courseStart: data?.preview?.course?.start_date || null,
        courseEnd: data?.preview?.course?.end_date || null,
      });
      const res = await fetch('/api/wizard/map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setMapped(json.preview);
    } catch (e: any) {
      setError(e?.message || 'Mapping failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-lg font-medium">Mapping</h2>
      <div className="text-sm text-slate-300/80">Select which columns correspond to Date, Topic, Readings, Assignments. Then Apply to all rows.</div>
      <div className="text-xs text-slate-300/60">Detected {rows.length} table-like rows · Most PDFs become 2 columns (Date = 0, Right column = 1). Adjust if needed.</div>
      {sample.length === 0 ? (
        <div className="text-sm text-slate-300/70">No table-like rows detected. Try uploading a DOCX/PDF with a table layout.</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm border border-[#1b2344]">
            <tbody>
              {sample.map((r, ri) => (
                <tr key={ri} className="border-b border-[#1b2344]">
                  {Array.from({ length: maxCols }, (_, ci) => (
                    <td key={ci} className="px-2 py-1 align-top">{r[ci] || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-4 items-center">
        <FieldSelect label="Date" value={dateCol} onChange={setDateCol} options={options} />
        <FieldSelect label="Topic" value={topicCol} onChange={setTopicCol} options={options} />
        <FieldSelect label="Readings" value={readingsCol} onChange={setReadingsCol} options={options} />
        <FieldSelect label="Assignments" value={assignCol} onChange={setAssignCol} options={options} />
        <button onClick={applyMapping} disabled={loading || sample.length === 0} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">{loading ? 'Applying…' : 'Apply to all'}</button>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}
      {mapped && (
        <div className="mt-2">
          <div className="text-sm text-slate-300/80 mb-1">Review (counts)</div>
          <div className="text-sm">Sessions: {mapped.sessions?.length || 0} · Readings: {mapped.readings?.length || 0} · Tasks: {mapped.tasks?.length || 0}</div>
          <div className="text-sm">Low-confidence: {mapped.lowConfidence?.length || 0}</div>
          <pre className="mt-2 text-[11px] whitespace-pre-wrap bg-[#0b1020] border border-[#1b2344] rounded p-2">{JSON.stringify(mapped, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: number; onChange: (n: number) => void; options: number[] }) {
  return (
    <label className="text-sm inline-flex items-center gap-2">
      <span className="text-slate-300/80">{label}</span>
      <select value={value} onChange={e => onChange(parseInt(e.target.value, 10))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
        {options.map(o => (<option key={o} value={o}>{o}</option>))}
      </select>
    </label>
  );
}
