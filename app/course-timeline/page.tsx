import { Suspense } from 'react';
import CourseTimelineClient from '@/components/CourseTimelineClient';

export default function CourseTimelinePage() {
  return (
    <main>
      <Suspense fallback={<div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading course timeline…</div>}>
        <CourseTimelineClient />
      </Suspense>
    </main>
  );
}
