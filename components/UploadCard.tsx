"use client";
import { useEffect, useState } from 'react';
import ParserReview from '@/components/ParserReview';
import type { NewTaskInput } from '@/lib/types';

export default function UploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [course, setCourse] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mpp, setMpp] = useState<string>('');
  const [preview, setPreview] = useState<boolean>(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTasks, setReviewTasks] = useState<NewTaskInput[]>([]);
  const [recScale, setRecScale] = useState<number | null>(null);
  const [recMpp, setRecMpp] = useState<number | null>(null);
  const [coursePreview, setCoursePreview] = useState<any | null>(null);
  const [mergeStatus, setMergeStatus] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    // initialize minutes-per-page from settings
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem('minutesPerPage');
    const n = s ? parseInt(s, 10) : NaN;
    setMpp(!isNaN(n) && n > 0 ? String(n) : '3');
  }, []);

  useEffect(() => {
    // when course changes, apply course-specific minutes-per-page override if present
    if (typeof window === 'undefined') return;
    const key = course.trim();
    if (!key) return;
    try {
      const mapRaw = window.localStorage.getItem('courseMppMap');
      const map = mapRaw ? JSON.parse(mapRaw) as Record<string, number> : {};
      if (map[key]) setMpp(String(map[key]));
    } catch {}
  }, [course]);

  useEffect(() => {
    // fetch learned scale for this course and suggest recommended MPP
    let aborted = false;
    async function run() {
      setRecScale(null); setRecMpp(null);
      const key = course.trim();
      if (!key) return;
      try {
        const res = await fetch(`/api/courses/prefs?course=${encodeURIComponent(key)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const scale = typeof data?.estScale === 'number' ? data.estScale : (typeof data?.course === 'string' ? 1 : null);
        if (aborted || scale === null) return;
        setRecScale(scale);
        const base = parseInt(mpp || '3', 10) || 3;
        const rec = Math.max(1, Math.round(base * scale));
        setRecMpp(rec);
      } catch {}
    }
    run();
    return () => { aborted = true; };
  }, [course, mpp]);

  async function onUpload() {
    if (!file) return;
    setLoading(true);
    setStatus(null);
    const fd = new FormData();
    fd.append('file', file);
    if (course) fd.append('course', course);
    if (mpp) fd.append('mpp', mpp);
    try {
      const url = preview ? '/api/upload?preview=1' : '/api/upload';
      const res = await fetch(url, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (preview && data.preview) {
        setReviewTasks(data.tasks as NewTaskInput[]);
        setReviewOpen(true);
        setCoursePreview(data.coursePreview || null);
      } else {
        setStatus(`Created ${data.createdCount} tasks${course ? ` for ${course}` : ''}.`);
        setCoursePreview(null);
      }
      // Remember per-course minutes-per-page
      if (typeof window !== 'undefined' && course && mpp) {
        try {
          const key = course.trim();
          const n = parseInt(mpp, 10);
          if (key && !isNaN(n) && n > 0) {
            const mapRaw = window.localStorage.getItem('courseMppMap');
            const map = mapRaw ? JSON.parse(mapRaw) as Record<string, number> : {};
            map[key] = n;
            window.localStorage.setItem('courseMppMap', JSON.stringify(map));
          }
        } catch {}
      }
    } catch (e: any) {
      setStatus('Upload failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Upload Syllabus</h2>
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-end">
        <div className="flex-1 w-full">
          <label className="block text-sm mb-1">Course (optional)</label>
          <input value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g., Contracts" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Minutes per page</label>
          <input type="number" min={1} step={1} value={mpp} onChange={e => setMpp(e.target.value)} className="w-32 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          {recMpp && recScale && (
            <div className="text-xs text-slate-300/70 mt-1">
              Recommended for {course || 'course'}: <span className="text-slate-200 font-medium">{recMpp} mpp</span> (scale ×{recScale})
              <button type="button" onClick={() => setMpp(String(recMpp))} className="ml-2 px-2 py-0.5 rounded border border-[#1b2344]">Apply</button>
            </div>
          )}
        </div>
        <label className="inline-flex items-center gap-2 text-sm mt-6">
          <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} /> Preview before saving
        </label>
        <div className="flex-1 w-full">
          <label className="block text-sm mb-1">File</label>
          <input type="file" accept=".pdf,.docx,.txt" onChange={e => setFile(e.target.files?.[0] || null)} className="w-full" />
          <button onClick={onUpload} disabled={!file || loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded mt-2">
            {loading ? 'Uploading...' : 'Upload & Parse'}
          </button>
        </div>
      </div>
      {status && <p className="mt-3 text-sm text-slate-300/90">{status}</p>}
      {mergeStatus && <p className="mt-2 text-xs text-slate-300/70">{mergeStatus}</p>}
      {/* Course merge preview */}
      {reviewOpen && coursePreview && (
        <div className="mt-4 border border-[#1b2344] rounded p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Course merge preview</div>
            {coursePreview.hasMeta ? (
              <div className="text-xs text-slate-300/70">{coursePreview.existing ? 'Existing course detected' : 'New course will be created'}</div>
            ) : (
              <div className="text-xs text-slate-300/70">No course metadata detected</div>
            )}
          </div>
          {coursePreview.hasMeta && (
            <div className="mt-2 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-slate-300/70 mb-1">Proposed</div>
                  <pre className="text-[11px] whitespace-pre-wrap bg-[#0b1020] border border-[#1b2344] rounded p-2">{JSON.stringify(coursePreview.proposed, null, 2)}</pre>
                </div>
                <div>
                  <div className="text-slate-300/70 mb-1">Existing</div>
                  <pre className="text-[11px] whitespace-pre-wrap bg-[#0b1020] border border-[#1b2344] rounded p-2">{coursePreview.existing ? JSON.stringify(coursePreview.existing, null, 2) : '(none)'}</pre>
                </div>
              </div>
              {coursePreview.changes && coursePreview.changes.length > 0 && (
                <div className="mt-2 text-slate-300/80">Changed fields: {coursePreview.changes.join(', ')}</div>
              )}
              <div className="mt-2">
                <button disabled={merging || !coursePreview.hasMeta} onClick={async () => {
                  if (!coursePreview?.hasMeta) return;
                  setMerging(true); setMergeStatus(null);
                  try {
                    if (coursePreview.existing && coursePreview.existing.id) {
                      const res = await fetch(`/api/courses/${coursePreview.existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(coursePreview.proposed || {}) });
                      if (!res.ok) throw new Error(await res.text());
                      setMergeStatus('Course updated from syllabus.');
                    } else {
                      const res = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(coursePreview.proposed || {}) });
                      if (!res.ok) throw new Error(await res.text());
                      setMergeStatus('Course created from syllabus.');
                    }
                  } catch (e: any) {
                    setMergeStatus('Merge failed: ' + (e?.message || 'Unknown error'));
                  } finally {
                    setMerging(false);
                  }
                }} className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">{merging ? 'Merging…' : (coursePreview.existing ? 'Apply merge' : 'Create course')}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {reviewOpen && (
        <div className="mt-4 border border-[#1b2344] rounded p-4">
          <ParserReview
            initial={reviewTasks}
            mppDefault={(() => { const n = parseInt(mpp, 10); return isNaN(n) ? undefined : n; })()}
            onCancel={() => setReviewOpen(false)}
            onSaved={(count) => { setReviewOpen(false); setStatus(`Created ${count} tasks${course ? ` for ${course}` : ''}.`); }}
          />
        </div>
      )}
    </div>
  );
}
