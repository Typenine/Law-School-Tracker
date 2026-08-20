import type { ReactNode } from 'react';
import WeekPlanAssignmentPanel from '@/components/WeekPlanAssignmentPanel';

export default function WeekPlanLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <WeekPlanAssignmentPanel />
      {children}
    </div>
  );
}
