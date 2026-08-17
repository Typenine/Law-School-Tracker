import { ensureSchema, listCourses } from '@/lib/storage';
import { ensureTaskV2Schema, getTaskWorkspace } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const [workspace, courses] = await Promise.all([getTaskWorkspace(), listCourses()]);
    return Response.json({ ...workspace, courses });
  } catch (error) {
    console.error('[task workspace]', error);
    return Response.json({ error: 'Unable to load the task workspace.' }, { status: 500 });
  }
}
