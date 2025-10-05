"use client";
import { useState, useRef } from 'react';
import type { Course, Semester } from '@/lib/types';

interface AddCourseWizardProps {
  onCourseAdded: (course: Course) => void;
  onClose: () => void;
}

const SEMESTERS: Semester[] = ['Spring', 'Summer', 'Fall'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS = [
  '#7c3aed', '#2563eb', '#dc2626', '#ea580c', '#ca8a04', 
  '#16a34a', '#0891b2', '#c2410c', '#9333ea', '#0d9488'
];

export default function AddCourseWizard({ onCourseAdded, onClose }: AddCourseWizardProps) {
  const [step, setStep] = useState(1);
  const [course, setCourse] = useState<Partial<Course>>({
    title: '',
    code: '',
    instructor: '',
    color: COLORS[0],
    meetingDays: [],
    meetingStart: '',
    meetingEnd: '',
    semester: undefined,
    year: new Date().getFullYear(),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const titleRef = useRef<HTMLInputElement>(null);

  const handleNext = () => {
    if (step === 1 && !course.title?.trim()) {
      setError('Course title is required');
      titleRef.current?.focus();
      return;
    }
    setError('');
    setStep(step + 1);
  };

  const handleBack = () => {
    setError('');
    setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!course.title?.trim()) {
      setError('Course title is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = {
        title: course.title.trim(),
        code: course.code?.trim() || null,
        instructor: course.instructor?.trim() || null,
        color: course.color || COLORS[0],
        meetingDays: course.meetingDays?.length ? course.meetingDays : null,
        meetingStart: course.meetingStart?.trim() || null,
        meetingEnd: course.meetingEnd?.trim() || null,
        semester: course.semester || null,
        year: course.year || null,
      };

      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.course) {
          onCourseAdded(data.course);
          onClose();
        } else {
          setError('No course returned from server');
        }
      } else {
        const errorText = await res.text();
        setError(`API Error (${res.status}): ${errorText}`);
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (dayIndex: number) => {
    const days = course.meetingDays || [];
    const newDays = days.includes(dayIndex)
      ? days.filter(d => d !== dayIndex)
      : [...days, dayIndex].sort();
    setCourse(prev => ({ ...prev, meetingDays: newDays }));
  };

  const fmt12 = (time24: string) => {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const h12 = ((h + 11) % 12) + 1;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0b1020] border border-[#1b2344] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Add New Course</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center mb-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  i <= step ? 'bg-blue-600 text-white' : 'bg-[#1b2344] text-slate-400'
                }`}>
                  {i}
                </div>
                {i < 3 && (
                  <div className={`w-12 h-0.5 mx-2 ${
                    i < step ? 'bg-blue-600' : 'bg-[#1b2344]'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium mb-4">Course Information</h3>
              
              <div>
                <label className="block text-sm font-medium mb-2">Course Title *</label>
                <input
                  ref={titleRef}
                  type="text"
                  value={course.title || ''}
                  onChange={(e) => setCourse(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Constitutional Law"
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Course Code</label>
                <input
                  type="text"
                  value={course.code || ''}
                  onChange={(e) => setCourse(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="e.g., LAW 101"
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Instructor</label>
                <input
                  type="text"
                  value={course.instructor || ''}
                  onChange={(e) => setCourse(prev => ({ ...prev, instructor: e.target.value }))}
                  placeholder="e.g., Professor Smith"
                  className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Course Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCourse(prev => ({ ...prev, color }))}
                      className={`w-8 h-8 rounded-full border-2 ${
                        course.color === color ? 'border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Schedule */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium mb-4">Class Schedule</h3>
              
              <div>
                <label className="block text-sm font-medium mb-2">Meeting Days</label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS.map((day, index) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(index)}
                      className={`px-3 py-2 rounded text-sm font-medium ${
                        course.meetingDays?.includes(index)
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#1b2344] text-slate-300 hover:bg-[#2a3454]'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Start Time</label>
                  <input
                    type="time"
                    value={course.meetingStart || ''}
                    onChange={(e) => setCourse(prev => ({ ...prev, meetingStart: e.target.value }))}
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">End Time</label>
                  <input
                    type="time"
                    value={course.meetingEnd || ''}
                    onChange={(e) => setCourse(prev => ({ ...prev, meetingEnd: e.target.value }))}
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {course.meetingDays?.length && course.meetingStart && course.meetingEnd && (
                <div className="p-3 bg-[#1b2344]/30 rounded">
                  <div className="text-sm text-slate-300">
                    <strong>Preview:</strong> {course.meetingDays.map(d => DAYS[d]).join(', ')} • {fmt12(course.meetingStart)} – {fmt12(course.meetingEnd)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Term */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium mb-4">Academic Term</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Semester</label>
                  <select
                    value={course.semester || ''}
                    onChange={(e) => setCourse(prev => ({ ...prev, semester: e.target.value as Semester || undefined }))}
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select semester</option>
                    {SEMESTERS.map(sem => (
                      <option key={sem} value={sem}>{sem}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Year</label>
                  <input
                    type="number"
                    value={course.year || ''}
                    onChange={(e) => setCourse(prev => ({ ...prev, year: e.target.value ? parseInt(e.target.value) : undefined }))}
                    placeholder="2024"
                    min="2020"
                    max="2030"
                    className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 bg-[#1b2344]/30 rounded">
                <h4 className="font-medium mb-2">Course Summary</h4>
                <div className="space-y-1 text-sm text-slate-300">
                  <div><strong>Title:</strong> {course.title || 'Untitled Course'}</div>
                  {course.code && <div><strong>Code:</strong> {course.code}</div>}
                  {course.instructor && <div><strong>Instructor:</strong> {course.instructor}</div>}
                  {course.meetingDays?.length && course.meetingStart && course.meetingEnd && (
                    <div><strong>Schedule:</strong> {course.meetingDays.map(d => DAYS[d]).join(', ')} • {fmt12(course.meetingStart)} – {fmt12(course.meetingEnd)}</div>
                  )}
                  {course.semester && course.year && (
                    <div><strong>Term:</strong> {course.semester} {course.year}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            <button
              onClick={step === 1 ? onClose : handleBack}
              className="px-4 py-2 text-slate-400 hover:text-slate-200"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            
            <div className="flex gap-2">
              {step < 3 ? (
                <button
                  onClick={handleNext}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded font-medium"
                >
                  {loading ? 'Creating...' : 'Create Course'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
