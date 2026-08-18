import { NextResponse } from 'next/server';
import { listCourses } from '@/lib/storage';
import { resolveCurrentSemesterState } from '@/lib/collections';
import { attachSemesterIds, buildSemesterOptions } from '@/lib/academic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const [{ term, semesters }, rawCourses] = await Promise.all([
      resolveCurrentSemesterState(),
      listCourses(),
    ]);
    const semesterOptions = buildSemesterOptions(semesters, rawCourses, term);
    const courses = attachSemesterIds(rawCourses, semesterOptions);
    return NextResponse.json({
      currentSemesterId: term.id,
      currentSemester: term,
      semesters: semesterOptions,
      courses,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load the academic catalog.' },
      { status: 500 },
    );
  }
}
