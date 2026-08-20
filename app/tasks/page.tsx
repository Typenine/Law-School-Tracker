import TaskTimerBar from '@/components/TaskTimerBar';
import TaskWorkspaceV2 from '@/components/TaskWorkspaceV2';

export default function TasksPage() {
  return (
    <div className="space-y-4">
      <TaskTimerBar />
      <TaskWorkspaceV2 />
    </div>
  );
}
