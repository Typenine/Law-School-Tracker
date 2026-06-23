import { Suspense } from 'react';
import WorkSessionClient from '@/components/WorkSessionClient';

export default function WorkPage() {
  return (
    <main>
      <Suspense fallback={<div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading work session…</div>}>
        <WorkSessionClient />
      </Suspense>
    </main>
  );
}
