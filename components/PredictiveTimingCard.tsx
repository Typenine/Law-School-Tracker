"use client";
import { useEffect, useState } from 'react';
import type { StatsPayload, Task } from '@/lib/types';

export default function PredictiveTimingCard() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, tasksRes] = await Promise.all([
          fetch('/api/stats', { cache: 'no-store' }),
          fetch('/api/tasks', { cache: 'no-store' })
        ]);
        
        const statsData = await statsRes.json();
        const tasksData = await tasksRes.json();
        
        setStats(statsData);
        setTasks(tasksData.tasks || []);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const getPredictedTime = (task: Task): number | null => {
    if (!stats?.subjectAverages || !task.course) return null;
    
    const subjectData = stats.subjectAverages.find(s => s.subject === task.course);
    return subjectData ? subjectData.avgMinutesPerTask : null;
  };

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const upcomingTasks = tasks
    .filter(t => t.status === 'todo')
    .filter(t => {
      const dueDate = new Date(t.dueDate);
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      return dueDate >= now && dueDate <= in7Days;
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 8); // Show next 8 tasks

  if (loading) {
    return (
      <div className="rounded border border-[#1b2344] p-4">
        <h3 className="text-sm font-medium mb-3">Predicted Task Times</h3>
        <div className="text-sm text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!stats?.subjectAverages?.length) {
    return (
      <div className="rounded border border-[#1b2344] p-4">
        <h3 className="text-sm font-medium mb-3">Predicted Task Times</h3>
        <div className="text-sm text-slate-400">
          Add historical tasks to see time predictions based on your past performance.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-[#1b2344] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Predicted Task Times</h3>
        <div className="text-xs text-slate-400">Next 7 days</div>
      </div>

      {upcomingTasks.length === 0 ? (
        <div className="text-sm text-slate-400">No upcoming tasks in the next 7 days.</div>
      ) : (
        <div className="space-y-2">
          {upcomingTasks.map((task) => {
            const predicted = getPredictedTime(task);
            const estimated = task.estimatedMinutes;
            
            return (
              <div key={task.id} className="flex items-center justify-between py-2 border-b border-[#1b2344]/50 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">
                    {task.title}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{task.course || 'No course'}</span>
                    <span>•</span>
                    <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 text-sm">
                  {estimated && (
                    <div className="text-slate-300">
                      <span className="text-xs text-slate-500">Est:</span> {formatTime(estimated)}
                    </div>
                  )}
                  
                  {predicted ? (
                    <div className="text-blue-400 font-medium">
                      <span className="text-xs text-slate-500">Pred:</span> {formatTime(predicted)}
                    </div>
                  ) : (
                    <div className="text-slate-500 text-xs">No data</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {stats.subjectAverages.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[#1b2344]/50">
          <div className="text-xs text-slate-400 mb-2">Historical averages:</div>
          <div className="grid grid-cols-1 gap-1">
            {stats.subjectAverages.slice(0, 3).map((subject) => (
              <div key={subject.subject} className="flex justify-between text-xs">
                <span className="text-slate-300 truncate">{subject.subject}</span>
                <span className="text-slate-400">
                  {formatTime(subject.avgMinutesPerTask)} ({subject.totalTasks} tasks)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
