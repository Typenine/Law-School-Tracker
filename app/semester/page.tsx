"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { BreaksByDow, SemesterInfo, WindowsByDow } from '@/lib/types';
import { apiFetch } from '@/lib/apiClient';
import { notifySemesterChanged } from '@/lib/semesterBus';
import { useSemester } from '@/lib/useSemester';

const EMPTY_WINDOWS: WindowsByDow = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
const EMPTY_BREAKS: BreaksByDow = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

type Season = SemesterInfo['season'];

function defaultsFor(season: Season, year: number) {
  if (season === 'Spring') return { startDate: `${year}-01-01`, endDate: `${year}-05-31` };
  if (season === 'Summer') return { startDate: `${year}-06-01`, endDate: `${year}-07-31` };
  if (season === 'Winter') return { startDate: `${year}-01-01`, endDate: `${year}-01-31` };
  return { startDate: `${year}-08-01`, endDate: `${year}-12-31` };
}

function nextTerm(active: SemesterInfo | null): { season: Season; year: number } {
  if (!active) return { season: 'Fall', year: 2026 };
  if (active.season === 'Fall') return { season: 'Spring', year: active.year + 1 };
  if (active.season === 'Spring') return { season: 'Summer', year: active.year };
  if (active.season === 'Summer') return { season: 'Fall', year: active.year };
  return { season: 'Spring', year: active.year };
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export default function SemesterPage() {
  const { semesters, activeSemester, currentTerm, setCurrentTerm, loading, refresh } = useSemester();
  const suggested = useMemo(() => nextTerm(activeSemester), [activeSemester]);
  const suggestedDates = useMemo(() => defaultsFor(suggested.season, suggested.year), [suggested]);

  const [season, setSeason] = useState<Season>('Fall');
  const [year, setYear] = useState<number>(2026);
  const [startDate, setStartDate] = useState('2026-08-01');
  const [endDate, setEndDate] = useState('2026-12-31');
  const [copyAvailability, setCopyAvailability] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setSeason(suggested.season);
    setYear(suggested.year);
    setStartDate(suggestedDates.startDate);
    setEndDate(suggestedDates.endDate);
  }, [suggested.season, suggested.year, suggestedDates.startDate, suggestedDates.endDate]);

  function updateSeason(next: Season) {
    setSeason(next);
    const dates = defaultsFor(next, year);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
  }

  function updateYear(next: number) {
    setYear(next);
    const dates = defaultsFor(season, next);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
  }

  async function loadAvailability(): Promise<{ windows: WindowsByDow; breaks: BreaksByDow }> {
    if (copyAvailability && activeSemester?.windowsByDow) {
      return {
        windows: activeSemester.windowsByDow,
        breaks: activeSemester.breaksByDow || EMPTY_BREAKS,
      };
    }
    if (!copyAvailability) return { windows: EMPTY_WINDOWS, breaks: EMPTY_BREAKS };

    try {
      const data = await apiFetch<{ settings: Record<string, any> }>('/api/settings?keys=availabilityWindowsV1,availabilityBreaksV1');
      return {
        windows: data?.settings?.availabilityWindowsV1 || EMPTY_WINDOWS,
        breaks: data?.settings?.availabilityBreaksV1 || EMPTY_BREAKS,
      };
    } catch {
      return { windows: EMPTY_WINDOWS, breaks: EMPTY_BREAKS };
    }
  }

  async function createSemester(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage('');
    setError('');
    try {
      const availability = await loadAvailability();
      const name = `${season} ${year}`;
      const data = await apiFetch<{ semester: SemesterInfo }>('/api/semesters', {
        method: 'POST',
        body: {
          name,
          season,
          year,
          startDate,
          endDate,
          isActive: true,
          windowsByDow: copyAvailability ? availability.windows : null,
          breaksByDow: copyAvailability ? availability.breaks : null,
        },
      });

      if (copyAvailability) {
        await apiFetch('/api/settings', {
          method: 'PATCH',
          body: {
            availabilityWindowsV1: availability.windows,
            availabilityBreaksV1: availability.breaks,
          },
        });
      }

      setCurrentTerm(data.semester.id);
      try { window.localStorage.setItem('tasksShowAllTerms', 'false'); } catch {}
      try { notifySemesterChanged(); } catch {}
      await refresh();
      setMessage(`${name} is now active. Old courses and assignments remain in history.`);
    } catch (cause: any) {
      setError(cause?.message || 'Could not create the semester.');
    } finally {
      setWorking(false);
    }
  }

  async function activateSemester(semester: SemesterInfo) {
    if (semester.id === currentTerm) return;
    setWorking(true);
    setMessage('');
    setError('');
    try {
      const updated = semesters.map((item) => ({ ...item, isActive: item.id === semester.id }));
      await apiFetch('/api/semesters', { method: 'PUT', body: { semesters: updated } });

      if (semester.windowsByDow || semester.breaksByDow) {
        await apiFetch('/api/settings', {
          method: 'PATCH',
          body: {
            availabilityWindowsV1: semester.windowsByDow || EMPTY_WINDOWS,
            availabilityBreaksV1: semester.breaksByDow || EMPTY_BREAKS,
          },
        });
      }

      setCurrentTerm(semester.id);
      try { window.localStorage.setItem('tasksShowAllTerms', 'false'); } catch {}
      try { notifySemesterChanged(); } catch {}
      await refresh();
      setMessage(`${semester.name} is now active.`);
    } catch (cause: any) {
      setError(cause?.message || 'Could not switch semesters.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <p className="text-sm font-medium text-emerald-300">Semester rollover</p>
        <div className="mt-1 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-100">
              {loading ? 'Loading semester…' : activeSemester ? `${activeSemester.name} is active` : 'Choose an active semester'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              New tasks belong to the active semester automatically. Switching semesters hides old coursework without deleting courses, tasks, logs, or reading history.
            </p>
          </div>
          {activeSemester ? (
            <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {formatDate(activeSemester.startDate)} through {formatDate(activeSemester.endDate)}
            </div>
          ) : null}
        </div>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
      {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-100">Prepare the next semester</h2>
            <p className="mt-1 text-sm text-slate-400">
              The next term is suggested automatically. The date range is a broad workspace boundary and can be adjusted before creation.
            </p>
          </div>

          <form onSubmit={createSemester} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm text-slate-300">
                <span>Semester</span>
                <select value={season} onChange={(event) => updateSeason(event.target.value as Season)} className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100">
                  <option value="Spring">Spring</option>
                  <option value="Summer">Summer</option>
                  <option value="Fall">Fall</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm text-slate-300">
                <span>Year</span>
                <input type="number" min={2025} max={2100} value={year} onChange={(event) => updateYear(Number(event.target.value))} className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" />
              </label>
              <label className="space-y-1.5 text-sm text-slate-300">
                <span>Start of workspace</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" />
              </label>
              <label className="space-y-1.5 text-sm text-slate-300">
                <span>End of workspace</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" />
              </label>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
              <input type="checkbox" checked={copyAvailability} onChange={(event) => setCopyAvailability(event.target.checked)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium text-slate-200">Copy weekly availability</span>
                <span className="block text-xs text-slate-400">Carries your study windows forward. Class times, courses, and assignments are not copied.</span>
              </span>
            </label>

            <button disabled={working || !startDate || !endDate || endDate < startDate} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
              {working ? 'Updating…' : `Start ${season} ${year}`}
            </button>
          </form>
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <h2 className="font-semibold text-slate-100">Semester history</h2>
            <div className="mt-3 space-y-2">
              {semesters.map((semester) => {
                const active = semester.id === currentTerm || semester.isActive;
                return (
                  <div key={semester.id} className={`rounded-lg border p-3 ${active ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-700 bg-slate-950/35'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-200">{semester.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{semester.startDate} to {semester.endDate}</p>
                      </div>
                      {active ? (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">Active</span>
                      ) : (
                        <button disabled={working} onClick={() => activateSemester(semester)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">Switch</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <h2 className="font-semibold text-slate-100">What happens at rollover</h2>
            <div className="mt-3 space-y-3 text-sm text-slate-400">
              <p><span className="font-medium text-slate-200">Kept:</span> old courses, completed tasks, study logs, pace data, and colors.</p>
              <p><span className="font-medium text-slate-200">Reset:</span> the Today list, open task view, calendar focus, and active course workspace.</p>
              <p><span className="font-medium text-slate-200">Not copied:</span> old readings, deadlines, class times, or assignments.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/courses" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Set up courses</Link>
              <Link href="/settings" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Edit availability</Link>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
