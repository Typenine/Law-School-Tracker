"use client";
import { useMemo, useState } from 'react';
import type { Course, CourseMeetingBlock, Semester, UpdateCourseInput } from '@/lib/types';
import TimePickerField from '@/components/TimePickerField';

type Props = {
  course: Course;
  onSaved: (updated: Course) => void;
  onClose: () => void;
};

const SEMS: Semester[] = ['Spring','Summer','Fall'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function EditCourseModal({ course, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<Partial<Course>>({ ...course });
  const [mode, setMode] = useState<'simple' | 'blocks'>(Array.isArray(course.meetingBlocks) && course.meetingBlocks.length ? 'blocks' : 'simple');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');

  const blocks: CourseMeetingBlock[] = useMemo(() => {
    const raw = (draft.meetingBlocks || []) as CourseMeetingBlock[];
    return Array.isArray(raw) ? raw : [];
  }, [draft.meetingBlocks]);

  function toggleSimpleDay(idx: number) {
    const set = new Set<number>((draft.meetingDays || []) as number[]);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    setDraft(d => ({ ...d, meetingDays: Array.from(set).sort((a, b) => a - b) }));
  }

  function addBlock() {
    const next: CourseMeetingBlock = { days: [], start: draft.meetingStart || '', end: draft.meetingEnd || '', location: draft.room || draft.location || '' };
    setDraft(d => ({ ...d, meetingBlocks: [ ...(blocks || []), next ] }));
  }
  function removeBlock(i: number) {
    const list = [...blocks]; list.splice(i, 1);
    setDraft(d => ({ ...d, meetingBlocks: list }));
  }
  function toggleBlockDay(i: number, idx: number) {
    const list = [...blocks];
    const set = new Set<number>(list[i]?.days || []);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    list[i] = { ...list[i], days: Array.from(set).sort((a, b) => a - b) };
    setDraft(d => ({ ...d, meetingBlocks: list }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      // Clean blocks: only keep ones with at least one day and both start & end
      const cleanBlocks: CourseMeetingBlock[] = (mode === 'blocks')
        ? ((draft.meetingBlocks || []) as CourseMeetingBlock[]).filter(b =>
            Array.isArray(b?.days) && b.days.length > 0 &&
            !!(b?.start && String(b.start).trim()) &&
            !!(b?.end && String(b.end).trim())
          )
        : [];

      const body: UpdateCourseInput = {
        code: (draft.code ?? null) || null,
        title: draft.title || course.title,
        instructor: (draft.instructor ?? null) || null,
        instructorEmail: (draft.instructorEmail ?? null) || null,
        room: (draft.room ?? null) || null,
        location: (draft.location ?? null) || null,
        color: (draft.color ?? null) || null,
        meetingDays: mode === 'simple' ? (draft.meetingDays || null) : null,
        meetingStart: mode === 'simple' ? (draft.meetingStart || null) : null,
        meetingEnd: mode === 'simple' ? (draft.meetingEnd || null) : null,
        meetingBlocks: mode === 'blocks' ? (cleanBlocks.length ? cleanBlocks : null) : null,
        startDate: draft.startDate || null,
        endDate: draft.endDate || null,
        semester: (draft.semester as any) || null,
        year: (typeof draft.year === 'number' ? draft.year : (draft.year ? parseInt(String(draft.year), 10) : null)) || null,
      };
      const res = await fetch(`/api/courses/${course.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed with ${res.status}`);
      }
      const data = await res.json();
      onSaved(data.course as Course);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function convertSimpleToBlocks() {
    const b: CourseMeetingBlock = {
      days: (draft.meetingDays || []) as number[],
      start: draft.meetingStart || '',
      end: draft.meetingEnd || '',
      location: draft.room || draft.location || ''
    };
    setDraft(d => ({ ...d, meetingBlocks: [b] }));
    setMode('blocks');
  }

  function addAnotherDayTime() {
    // Convert to blocks (if not already) and add a second, blank block with same times
    const first: CourseMeetingBlock = {
      days: (draft.meetingDays || []) as number[],
      start: draft.meetingStart || '',
      end: draft.meetingEnd || '',
      location: draft.room || draft.location || ''
    };
    const second: CourseMeetingBlock = { days: [], start: draft.meetingStart || '', end: draft.meetingEnd || '', location: '' };
    setDraft(d => ({ ...d, meetingBlocks: [first, second] }));
    setMode('blocks');
  }

  function splitSelectedDaysIntoBlocks() {
    const days = ((draft.meetingDays || []) as number[]) || [];
    const blocks = days.map(d => ({ days: [d], start: draft.meetingStart || '', end: draft.meetingEnd || '', location: draft.room || draft.location || '' } as CourseMeetingBlock));
    setDraft(prev => ({ ...prev, meetingBlocks: blocks.length ? blocks : [{ days: [], start: draft.meetingStart || '', end: draft.meetingEnd || '', location: '' }] }));
    setMode('blocks');
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-full max-w-3xl rounded border border-[#1b2344] bg-[#0b1020] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Edit Course</h3>
          <button onClick={onClose} className="text-xs underline">Close</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Title</label>
            <input value={draft.title || ''} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Code</label>
            <input value={draft.code || ''} onChange={e => setDraft(d => ({ ...d, code: e.target.value }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Instructor</label>
            <input value={draft.instructor || ''} onChange={e => setDraft(d => ({ ...d, instructor: e.target.value }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Color</label>
            <input type="color" value={(draft.color as any) || '#7c3aed'} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} className="h-8 w-12 bg-transparent" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Start Date</label>
            <input type="date" value={draft.startDate ? String(draft.startDate).slice(0,10) : ''} onChange={e => setDraft(d => ({ ...d, startDate: e.target.value || null }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">End Date</label>
            <input type="date" value={draft.endDate ? String(draft.endDate).slice(0,10) : ''} onChange={e => setDraft(d => ({ ...d, endDate: e.target.value || null }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Semester</label>
            <select value={(draft.semester as any) || ''} onChange={e => setDraft(d => ({ ...d, semester: (e.target.value || null) as any }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
              <option value="">—</option>
              {SEMS.map(s => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Year</label>
            <input type="number" value={(draft.year as any) || ''} onChange={e => setDraft(d => ({ ...d, year: e.target.value ? parseInt(e.target.value, 10) : null }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-300/70">Schedule</div>
            <div className="inline-flex rounded border border-[#1b2344] overflow-hidden text-xs">
              <button className={`px-2 py-1 ${mode==='simple' ? 'bg-[#1a2243]' : ''}`} onClick={() => setMode('simple')}>Simple</button>
              <button className={`px-2 py-1 ${mode==='blocks' ? 'bg-[#1a2243]' : ''}`} onClick={() => setMode('blocks')}>Different per day</button>
            </div>
          </div>

          {mode === 'simple' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {DAYS.map((d, idx) => (
                  <label key={d} className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={(draft.meetingDays || []).includes(idx)} onChange={() => toggleSimpleDay(idx)} />{d}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <TimePickerField value={draft.meetingStart || ''} onChange={(v) => setDraft(d => ({ ...d, meetingStart: v }))} />
                <span className="text-xs">–</span>
                <TimePickerField value={draft.meetingEnd || ''} onChange={(v) => setDraft(d => ({ ...d, meetingEnd: v }))} />
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button onClick={convertSimpleToBlocks} className="underline">Convert to different times per day</button>
                <span className="text-slate-500">·</span>
                <button onClick={addAnotherDayTime} className="underline">Add another day/time</button>
                <span className="text-slate-500">·</span>
                <button onClick={splitSelectedDaysIntoBlocks} className="underline">Different time per selected day</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {(blocks || []).map((b, i) => (
                <div key={i} className="border border-[#1b2344] rounded p-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-slate-300/70">Block {i+1}</div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => {
                        const list = [...blocks];
                        const cur = list[i] || { days: [], start: '', end: '', location: '' } as CourseMeetingBlock;
                        const dup: CourseMeetingBlock = { days: [...(cur.days||[])], start: cur.start, end: cur.end, location: cur.location };
                        setDraft(d => ({ ...d, meetingBlocks: [...list.slice(0, i+1), dup, ...list.slice(i+1)] }));
                      }} className="text-xs underline">Duplicate</button>
                      <button onClick={() => removeBlock(i)} className="text-xs underline">Remove</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {DAYS.map((d, idx) => (
                      <label key={d} className="inline-flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={(b.days || []).includes(idx)} onChange={() => toggleBlockDay(i, idx)} />{d}
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <TimePickerField value={b.start || ''} onChange={(v) => {
                      const list = [...blocks]; list[i] = { ...list[i], start: v };
                      setDraft(d => ({ ...d, meetingBlocks: list }));
                    }} />
                    <span className="text-xs">–</span>
                    <TimePickerField value={b.end || ''} onChange={(v) => {
                      const list = [...blocks]; list[i] = { ...list[i], end: v };
                      setDraft(d => ({ ...d, meetingBlocks: list }));
                    }} />
                    <input placeholder="Location (optional)" value={b.location || ''} onChange={e => {
                      const list = [...blocks]; list[i] = { ...list[i], location: e.target.value };
                      setDraft(d => ({ ...d, meetingBlocks: list }));
                    }} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                </div>
              ))}
              <button onClick={addBlock} className="text-xs px-2 py-1 rounded border border-[#1b2344]">Add time block</button>
            </div>
          )}
        </div>

        {error && <div className="mt-3 text-xs text-rose-400">{error}</div>}

        <div className="mt-4 flex items-center gap-2">
          <button disabled={saving} onClick={save} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save Changes'}</button>
          <button onClick={onClose} className="px-3 py-2 rounded border border-[#1b2344]">Cancel</button>
        </div>
      </div>
    </div>
  );
}
