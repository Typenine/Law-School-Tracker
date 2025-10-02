"use client";
import { useState } from 'react';

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
      <h1 className="text-xl font-semibold">Syllabus Import Wizard (Preview)</h1>
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
            <label className="block text-sm mb-1">Syllabus file</label>
            <input type="file" accept=.pdf,.docx,.txt onChange={e => setFile(e.target.files?.[0] || null)} className="w-full" />
          </div>
        </div>
        <div>
          <button onClick={onUpload} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50" disabled={!file || loading}>{loading ? 'Processing…' : 'Preview'}</button>
        </div>
        {error && <div className="text-sm text-rose-400">{error}</div>}
      </div>
      {data && (
        <div className="card p-4">
          <h2 className="text-lg font-medium mb-2">Preview</h2>
          <div className="text-sm text-slate-300/80 mb-2">Low-confidence items will need review in the full wizard.</div>
          <pre className="text-[11px] whitespace-pre-wrap bg-[#0b1020] border border-[#1b2344] rounded p-2">{JSON.stringify(data.preview, null, 2)}</pre>
        </div>
      )}
    </main>
  );
}
