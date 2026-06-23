import { NextRequest, NextResponse } from 'next/server';
import { compareSyllabusVersions } from '@/lib/syllabusCompare';
import type { StoredSyllabusAnalysis } from '@/lib/courseWorkspace';
import { readCourseWorkspace, writeCourseWorkspace } from '@/lib/courseWorkspaceStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: NextRequest, context: { params: { id: string } }) {
  const current = await readCourseWorkspace(context.params.id);
  return NextResponse.json({
    analysis: current.workspace.syllabusAnalysis || null,
    versions: current.workspace.syllabusVersions || [],
    latestDiff: current.workspace.latestSyllabusDiff || null,
    revision: current.revision,
  });
}

export async function PUT(req: NextRequest, context: { params: { id: string } }) {
  try {
    const body = await req.json();
    const incoming = body?.analysis as StoredSyllabusAnalysis | undefined;
    if (!incoming || typeof incoming !== 'object') return NextResponse.json({ error: 'analysis is required' }, { status: 400 });

    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await readCourseWorkspace(context.params.id);
      const previous = current.workspace.syllabusAnalysis;
      const analysis: StoredSyllabusAnalysis = {
        ...incoming,
        id: incoming.id || `syllabus:${context.params.id}:${Date.now()}`,
        importedAt: incoming.importedAt || new Date().toISOString(),
      };
      const diff = compareSyllabusVersions(previous, analysis);
      const versions = [...(current.workspace.syllabusVersions || []), ...(previous ? [previous] : [])]
        .filter((version, index, all) => all.findIndex(item => item.id === version.id && item.importedAt === version.importedAt) === index)
        .slice(-10);
      const result = await writeCourseWorkspace(context.params.id, {
        ...current.workspace,
        syllabusAnalysis: analysis,
        syllabusVersions: versions,
        latestSyllabusDiff: diff,
      }, current.revision);
      if (!result.conflict) return NextResponse.json({ success: true, analysis, diff, versions, revision: result.revision });
    }
    return NextResponse.json({ error: 'Course data changed during syllabus save. Try again.' }, { status: 409 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to save syllabus analysis.' }, { status: 500 });
  }
}
