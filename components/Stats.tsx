"use client";
import { useEffect, useMemo, useState } from 'react';
import { StatsPayload } from '@/lib/types';

export default function Stats() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [weeklyGoal, setWeeklyGoal] = useState<number>(20);

  async function refresh() {
    const res = await fetch('/api/stats', { cache: 'no-store' });
    const data = await res.json();
    setStats(data as StatsPayload);
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem('weeklyGoalHours');
    if (s) {
      const n = parseFloat(s);
      if (!isNaN(n) && n > 0) setWeeklyGoal(n);
    }
  }, []);

  const progress = useMemo(() => {
    if (!stats || !weeklyGoal) return 0;
    return Math.min(100, Math.round((stats.hoursThisWeek / weeklyGoal) * 100));
  }, [stats, weeklyGoal]);

  const burndownPct = useMemo(() => {
    if (!stats || stats.estMinutesThisWeek <= 0) return 0;
    return Math.min(100, Math.round((stats.loggedMinutesThisWeek / stats.estMinutesThisWeek) * 100));
  }, [stats]);

  const [heavyThreshold, setHeavyThreshold] = useState<number>(240);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem('heavyDayThreshold');
    const n = s ? parseFloat(s) : NaN;
    if (!isNaN(n) && n > 0) setHeavyThreshold(n);
  }, []);

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Stats</h2>
      {!stats ? (
        <p className="text-sm">Loading...</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs">Upcoming 7 days</div>
              <div className="text-2xl font-semibold mt-1">{stats.upcoming7d}</div>
            </div>
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs">Hours this week</div>
              <div className="text-2xl font-semibold mt-1">{stats.hoursThisWeek}</div>
            </div>
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs">Focus this week</div>
              <div className="text-2xl font-semibold mt-1">{stats.avgFocusThisWeek ?? '-'}</div>
            </div>
            <div className="rounded border border-[#1b2344] p-4 bg-blue-900/20">
              <div className="text-slate-300/70 text-xs">Hours / 7d avg</div>
              <div className="text-2xl font-semibold mt-1 text-blue-400">{stats.avgHours7d?.toFixed(1) ?? '-'}</div>
            </div>
            <div className="rounded border border-[#1b2344] p-4 bg-purple-900/20">
              <div className="text-slate-300/70 text-xs">Focus / 7d avg</div>
              <div className="text-2xl font-semibold mt-1 text-purple-400">{stats.avgFocus7d?.toFixed(1) ?? '-'}</div>
            </div>
          </div>

          <div className="rounded border border-[#1b2344] p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <div className="text-slate-300/70 text-xs mb-1">Weekly goal (hours)</div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={weeklyGoal}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value || '0');
                    if (!isNaN(v) && v > 0) {
                      setWeeklyGoal(v);
                      if (typeof window !== 'undefined') window.localStorage.setItem('weeklyGoalHours', String(v));
                    }
                  }}
                  className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
                />
              </div>
              <div className="flex-1">
                <div className="text-slate-300/70 text-xs mb-1">Progress</div>
                <div className="h-3 w-full rounded bg-[#0b1020] border border-[#1b2344] overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${progress}%` }} />
                </div>
                <div className="text-xs text-slate-300/70 mt-1">{stats.hoursThisWeek} / {weeklyGoal} hrs ({progress}%)</div>
              </div>
            </div>
          </div>

          <div className="rounded border border-[#1b2344] p-4">
            <div className="mb-2">
              <div className="text-slate-300/70 text-xs">Burndown (this week)</div>
              <div className="text-sm mt-1">Logged {Math.round(stats.loggedMinutesThisWeek)}m of {Math.round(stats.estMinutesThisWeek)}m • Remaining {Math.round(stats.remainingMinutesThisWeek)}m</div>
            </div>
            <div className="h-3 w-full rounded bg-[#0b1020] border border-[#1b2344] overflow-hidden">
              <div className="h-full bg-emerald-600" style={{ width: `${burndownPct}%` }} />
            </div>
          </div>

          {stats.dailyEst && stats.dailyEst.length > 0 && (
            <div className="rounded border border-[#1b2344] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-300/70 text-xs">Next 7 days forecast (est. minutes due per day)</div>
                <div className="text-xs text-slate-300/60">Heavy days: {stats.heavyDays ?? 0}</div>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {stats.dailyEst.map((d, i) => {
                  const max = stats.maxDayMinutes || 1;
                  const pct = Math.min(100, Math.round((d.estMinutes / max) * 100));
                  return (
                    <div key={i} className="flex flex-col items-center">
                      <div className="h-20 w-6 border border-[#1b2344] bg-[#0b1020] flex items-end">
                        <div className={`w-full ${d.estMinutes >= heavyThreshold ? 'bg-rose-600' : 'bg-indigo-600'}`} style={{ height: `${pct}%` }} />
                      </div>
                      <div className="text-[10px] mt-1 text-slate-300/70">{new Date(d.date).toLocaleDateString(undefined, { weekday:'short' })}</div>
                      <div className="text-[10px] text-slate-300/60">{Math.round(d.estMinutes)}m</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats.courseBreakdown && stats.courseBreakdown.length > 0 && (
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs mb-2">Per-course (this week)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-300/60">
                    <tr>
                      <th className="py-1 pr-4">Course</th>
                      <th className="py-1 pr-4">Est. m</th>
                      <th className="py-1 pr-4">Logged m</th>
                      <th className="py-1 pr-4">Remaining m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.courseBreakdown.map((c, i) => (
                      <tr key={i} className="border-t border-[#1b2344]">
                        <td className="py-1 pr-4">{c.course || '-'}</td>
                        <td className="py-1 pr-4">{Math.round(c.estMinutes)}</td>
                        <td className="py-1 pr-4">{Math.round(c.loggedMinutes)}</td>
                        <td className="py-1 pr-4">{Math.round(c.remainingMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
