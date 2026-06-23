import { NextRequest, NextResponse } from 'next/server';
import { readCourseWorkspace, writeCourseWorkspace } from '@/lib/courseWorkspaceStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get('courseId') || '';
  if (!courseId) return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
  const result = await readCourseWorkspace(courseId);
  return NextResponse.json({ workspace: result.workspace, revision: result.revision });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body?.courseId || !body?.workspace) return NextResponse.json({ error: 'courseId and workspace are required' }, { status: 400 });
  const result = await writeCourseWorkspace(String(body.courseId), body.workspace, Number(body.expectedRevision || 0));
  return NextResponse.json(result, { status: result.conflict ? 409 : 200 });
}
