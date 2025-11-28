/**
 * Shared course matching utilities for consistent course attribution
 * across all pages (Courses, Review, Log, etc.)
 */

// Normalize course name for fuzzy matching
export function normCourseKey(name?: string | null): string {
  let x = (name || '').toString().toLowerCase().trim();
  if (!x) return '';
  x = x.replace(/&/g, 'and');
  x = x.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  // Remove trailing "law" for matching (e.g., "criminal law" -> "criminal")
  if (/\blaw$/.test(x)) x = x.replace(/\s*law$/, '');
  return x;
}

// Extract course from notes like "[Course Name] ..."
export function extractCourseFromNotes(notes?: string | null): string {
  if (!notes) return '';
  const m = notes.match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : '';
}

// Get course name from a session using consistent logic
export function getSessionCourse(
  session: { taskId?: string | null; activity?: string | null; notes?: string | null },
  tasksById: Map<string, { course?: string | null }>
): string {
  let course = '';
  
  // 1) First try to get from linked task
  if (session.taskId && tasksById.has(session.taskId)) {
    course = tasksById.get(session.taskId)?.course || '';
  }
  
  // 2) If no task course, check activity or notes
  if (!course) {
    const act = (session.activity || '').toLowerCase();
    if (act === 'internship') {
      course = 'Internship';
    } else {
      course = extractCourseFromNotes(session.notes);
    }
  }
  
  // 3) Special handling for sports law review
  const courseL = (course || '').toLowerCase();
  if (courseL.includes('sports law review') || /\bslr\b/i.test(session.notes || '')) {
    course = 'Sports Law Review';
  }
  
  return course || 'Unassigned';
}

// Check if a session course matches a target course using normalized matching
export function courseMatches(sessionCourse: string, targetCourseTitle: string, targetCourseCode?: string | null): boolean {
  const sessionKey = normCourseKey(sessionCourse);
  const titleKey = normCourseKey(targetCourseTitle);
  const codeKey = targetCourseCode ? normCourseKey(targetCourseCode) : '';
  
  if (!sessionKey || !titleKey) return false;
  
  if (sessionKey === titleKey) return true;
  if (codeKey && sessionKey === codeKey) return true;
  if (sessionKey.includes(titleKey) || titleKey.includes(sessionKey)) return true;
  if (codeKey && (sessionKey.includes(codeKey) || codeKey.includes(sessionKey))) return true;
  return false;
}

// Build a tasks-by-id map from an array of tasks
export function buildTasksById<T extends { id: string }>(tasks: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const t of tasks) {
    if (t && t.id) map.set(t.id, t);
  }
  return map;
}
