import { NextRequest } from 'next/server';
import { ensureSchema, getGptPool, listCourses } from '@/lib/storage';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;

  try {
    await ensureSchema();
    const courses = (await listCourses(getGptPool())).map(course => ({
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
    console.error('[gpt/courses]', error);
    return noStoreJson({ error: 'Unable to load courses. Try again shortly.' }, { status: 500 });
  }
}
