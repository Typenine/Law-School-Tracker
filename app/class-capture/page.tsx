import { Suspense } from 'react';
import ClassCaptureForm from '@/components/ClassCaptureForm';

export default function ClassCapturePage() {
  return <main><Suspense fallback={<div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading class capture…</div>}><ClassCaptureForm /></Suspense></main>;
}
