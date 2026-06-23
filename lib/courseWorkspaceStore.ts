import { COURSE_WORKSPACES_KEY, type CourseWorkspace, type CourseWorkspaceMap } from './courseWorkspace';
import { compareAndSwapCourseWorkspace } from './courseWorkspaceCas';
import { getSettings } from './storage';

export type VersionedWorkspace = CourseWorkspace & { _revision?: number; _updatedAt?: string };

export async function readCourseWorkspace(courseId: string) {
  const settings = await getSettings([COURSE_WORKSPACES_KEY]);
  const map = (settings[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
  const workspace = (map[courseId] || {}) as VersionedWorkspace;
  return { map, workspace, revision: Number(workspace._revision || 0) };
}

function cleanWorkspace(workspace: VersionedWorkspace) {
  const seen = new Set<string>();
  const questions = (workspace.questions || []).filter(question => {
    const key = question.text.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...workspace, questions };
}

export async function writeCourseWorkspace(courseId: string, incoming: VersionedWorkspace, expectedRevision: number) {
  const revision = expectedRevision + 1;
  const workspace = cleanWorkspace({ ...incoming, _revision: revision, _updatedAt: new Date().toISOString() });
  return compareAndSwapCourseWorkspace(courseId, expectedRevision, workspace);
}
