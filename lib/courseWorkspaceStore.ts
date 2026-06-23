import { COURSE_WORKSPACES_KEY, type CourseWorkspace, type CourseWorkspaceMap } from './courseWorkspace';
import { getSettings, patchSettings } from './storage';

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
  const current = await readCourseWorkspace(courseId);
  if (expectedRevision !== current.revision) return { conflict: true as const, workspace: current.workspace, revision: current.revision };
  const revision = current.revision + 1;
  const workspace = cleanWorkspace({ ...incoming, _revision: revision, _updatedAt: new Date().toISOString() });
  await patchSettings({ [COURSE_WORKSPACES_KEY]: { ...current.map, [courseId]: workspace } });
  return { conflict: false as const, workspace, revision };
}
