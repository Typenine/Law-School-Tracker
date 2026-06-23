import { NextRequest, NextResponse } from 'next/server';
import { COURSE_WORKSPACES_KEY, CourseWorkspaceMap, StoredSyllabusAnalysis } from '@/lib/courseWorkspace';
import { getSettings, patchSettings } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: NextRequest, context: { params: { id: string } }) {
  const settings = await getSettings([COURSE_WORKSPACES_KEY]);
  const map = (settings[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
  return NextResponse.json({ analysis: map[context.params.id]?.syllabusAnalysis || null });
}

export async function PUT(req: NextRequest, context: { params: { id: string } }) {
  try {
    const body = await req.json();
    const analysis = body?.analysis as StoredSyllabusAnalysis | undefined;
    if (!analysis || typeof analysis !== 'object') return NextResponse.json({ error: 'analysis is required' }, { status: 400 });
    const settings = await getSettings([COURSE_WORKSPACES_KEY]);
    const map = (settings[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
    const nextMap: CourseWorkspaceMap = {
      ...map,
      [context.params.id]: {
        ...(map[context.params.id] || {}),
        syllabusAnalysis: analysis,
      },
    };
    await patchSettings({ [COURSE_WORKSPACES_KEY]: nextMap });
    return NextResponse.json({ success: true, analysis });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to save syllabus analysis.' }, { status: 500 });
  }
}
