import { NextRequest, NextResponse } from 'next/server';
import { compareSyllabusVersions } from '@/lib/academicWorkflow';
import { COURSE_WORKSPACES_KEY, CourseWorkspaceMap, StoredSyllabusAnalysis } from '@/lib/courseWorkspace';
import { getSettings, patchSettings } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: NextRequest, context: { params: { id: string } }) {
  const settings = await getSettings([COURSE_WORKSPACES_KEY]);
  const map = (settings[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
  const workspace = map[context.params.id] || {};
  return NextResponse.json({
    analysis: workspace.syllabusAnalysis || null,
    versions: workspace.syllabusVersions || [],
    latestDiff: workspace.latestSyllabusDiff || null,
  });
}

export async function PUT(req: NextRequest, context: { params: { id: string } }) {
  try {
    const body = await req.json();
    const incoming = body?.analysis as StoredSyllabusAnalysis | undefined;
    if (!incoming || typeof incoming !== 'object') return NextResponse.json({ error: 'analysis is required' }, { status: 400 });
    const settings = await getSettings([COURSE_WORKSPACES_KEY]);
    const map = (settings[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
    const currentWorkspace = map[context.params.id] || {};
    const previous = currentWorkspace.syllabusAnalysis;
    const analysis: StoredSyllabusAnalysis = {
      ...incoming,
      id: incoming.id || `syllabus:${context.params.id}:${Date.now()}`,
      importedAt: incoming.importedAt || new Date().toISOString(),
    };
    const diff = compareSyllabusVersions(previous, analysis);
    const versions = [...(currentWorkspace.syllabusVersions || []), ...(previous ? [previous] : [])]
      .filter((version, index, all) => all.findIndex(item => item.id === version.id && item.importedAt === version.importedAt) === index)
      .slice(-10);
    const nextMap: CourseWorkspaceMap = {
      ...map,
      [context.params.id]: {
        ...currentWorkspace,
        syllabusAnalysis: analysis,
        syllabusVersions: versions,
        latestSyllabusDiff: diff,
      },
    };
    await patchSettings({ [COURSE_WORKSPACES_KEY]: nextMap });
    return NextResponse.json({ success: true, analysis, diff, versions });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to save syllabus analysis.' }, { status: 500 });
  }
}
