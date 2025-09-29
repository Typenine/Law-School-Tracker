import NextDynamic from 'next/dynamic';

export const dynamic = 'force-dynamic';

const PlannerBoard = NextDynamic(() => import('@/components/PlannerBoard'), { ssr: false });

export default async function PlannerPage() {
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-medium">Planner (Next 7 days)</h2>
      <PlannerBoard />
    </main>
  );
}
