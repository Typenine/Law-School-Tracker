import '@/lib/types';

declare module '@/lib/types' {
  interface Task {
    /** Optional client-side freshness marker used by richer task surfaces. */
    updatedAt?: string;
  }
}
