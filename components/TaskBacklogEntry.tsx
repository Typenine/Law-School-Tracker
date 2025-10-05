"use client";
import { useState, useRef } from 'react';
import type { Course } from '@/lib/types';

interface TaskBacklogEntryProps {
  courses: Course[];
  onTaskAdded: () => void;
  onClose: () => void;
}

const ACTIVITIES = [
  { value: 'reading', label: 'Reading' },
  { value: 'review', label: 'Review' },
  { value: 'outline', label: 'Outline' },
  { value: 'practice', label: 'Practice Problems' },
  { value: 'other', label: 'Other' },
];

export default function TaskBacklogEntry({ courses, onTaskAdded, onClose }: TaskBacklogEntryProps) {
  const [task, setTask] = useState({
    title: '',
    course: '',
    dueDate: '',
    completedAt: '',
    actualMinutes: '',
    focus: '',
    pagesRead: '',
    activity: 'reading',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const titleRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!task.title.trim()) {
      setError('Task title is required');
      titleRef.current?.focus();
      return;
    }

    if (!task.dueDate) {
      setError('Due date is required');
      return;
    }

    if (!task.completedAt) {
      setError('Completion date is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Create the task as completed
      const taskPayload = {
        title: task.title.trim(),
        course: task.course || null,
        dueDate: new Date(task.dueDate + 'T23:59:59').toISOString(),
        status: 'done',
        actualMinutes: task.actualMinutes ? parseInt(task.actualMinutes) : null,
        completedAt: new Date(task.completedAt + 'T12:00:00').toISOString(),
        focus: task.focus ? parseInt(task.focus) : null,
        pagesRead: task.pagesRead ? parseInt(task.pagesRead) : null,
        activity: task.activity || null,
        notes: task.notes.trim() || null,
      };

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload),
      });

      if (res.ok) {
        onTaskAdded();
        onClose();
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to add task' }));
        setError(errorData.error || 'Failed to add task');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0b1020] border border-[#1b2344] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Add Historical Task</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm text-slate-400 mb-6">
            Add a task that you've already completed to build historical data for better time predictions.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Task Title *</label>
              <input
                ref={titleRef}
                type="text"
                value={task.title}
                onChange={(e) => setTask(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., Read Chapter 5: Constitutional Interpretation"
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Course</label>
                <select
                  value={task.course}
                  onChange={(e) => setTask(prev => ({ ...prev, course: e.target.value }))}
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.title}>
                      {course.code ? `${course.code} - ${course.title}` : course.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Activity Type</label>
                <select
                  value={task.activity}
                  onChange={(e) => setTask(prev => ({ ...prev, activity: e.target.value }))}
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  {ACTIVITIES.map((activity) => (
                    <option key={activity.value} value={activity.value}>
                      {activity.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Due Date *</label>
                <input
                  type="date"
                  value={task.dueDate}
                  onChange={(e) => setTask(prev => ({ ...prev, dueDate: e.target.value }))}
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Completed Date *</label>
                <input
                  type="date"
                  value={task.completedAt}
                  onChange={(e) => setTask(prev => ({ ...prev, completedAt: e.target.value }))}
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Time Spent (minutes)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={task.actualMinutes}
                  onChange={(e) => setTask(prev => ({ ...prev, actualMinutes: e.target.value }))}
                  placeholder="e.g., 90"
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Focus Level (1-10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={task.focus}
                  onChange={(e) => setTask(prev => ({ ...prev, focus: e.target.value }))}
                  placeholder="e.g., 8"
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Pages Read</label>
                <input
                  type="number"
                  min="0"
                  value={task.pagesRead}
                  onChange={(e) => setTask(prev => ({ ...prev, pagesRead: e.target.value }))}
                  placeholder="e.g., 25"
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Notes (optional)</label>
              <textarea
                value={task.notes}
                onChange={(e) => setTask(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any additional notes about this task..."
                rows={3}
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded font-medium"
              >
                {loading ? 'Adding...' : 'Add Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
