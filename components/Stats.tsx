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

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Stats</h2>
      {!stats ? (
        <p className="text-sm">Loading...</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs">Upcoming 7 days</div>
              <div className="text-2xl font-semibold mt-1">{stats.upcoming7d}</div>
            </div>
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs">Hours this week</div>
              <div className="text-2xl font-semibold mt-1">{stats.hoursThisWeek}</div>
            </div>
            <div className="rounded border border-[#1b2344] p-4">
              <div className="text-slate-300/70 text-xs">Avg focus this week</div>
              <div className="text-2xl font-semibold mt-1">{stats.avgFocusThisWeek ?? '-'}</div>
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
        </div>
      )}
    </div>
  );
}
