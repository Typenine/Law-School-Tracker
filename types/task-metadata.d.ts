import '@/lib/types';

declare module '@/lib/types' {
  export type TaskLifecycle = 'active' | 'archived' | 'canceled';

  interface Task {
    courseId?: string | null;
    lifecycle?: TaskLifecycle;
  }

  interface NewTaskInput {
    courseId?: string | null;
    lifecycle?: TaskLifecycle;
  }

  interface UpdateTaskInput {
    courseId?: string | null;
    lifecycle?: TaskLifecycle;
  }
}
