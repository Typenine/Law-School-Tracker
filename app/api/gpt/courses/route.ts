import { NextRequest } from 'next/server';
import { ensureSchema, listCourses } from '@/lib/storage';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;

  try {
    await ensureSchema();
    const courses = (await listCourses()).map(course => ({
      id: course.id,
      code: course.code ?? null,
      title: course.title,
      instructor: course.instructor ?? null,
      semester: course.semester ?? null,
      year: course.year ?? null,
      startDate: course.startDate ?? null,
      endDate: course.endDate ?? null,
      defaultActivity: course.defaultActivity ?? null,
    }));
    return noStoreJson({ courses });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load courses.' },
      { status: 500 },
    );
  }
}
