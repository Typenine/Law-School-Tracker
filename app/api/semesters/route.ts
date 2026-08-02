import { NextRequest, NextResponse } from 'next/server';
import type { SemesterInfo, NewSemesterInput } from '@/lib/types';
import { mutateSemesters, readSemesters, uid } from '@/lib/collections';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const active = url.searchParams.get('active');

  try {
    let semesters = await readSemesters();
    if (active === 'true') semesters = semesters.filter(s => s.isActive);
    semesters.sort((a, b) => b.startDate.localeCompare(a.startDate));
    return NextResponse.json({ semesters });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to load semesters.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: NewSemesterInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!body?.name || !body?.season || !body?.year || !body?.startDate || !body?.endDate) {
    return NextResponse.json(
      { error: 'name, season, year, startDate, and endDate are required' },
      { status: 400 },
    );
  }

  const semester: SemesterInfo = {
    id: uid(),
    name: body.name,
    season: body.season,
    year: body.year,
    startDate: body.startDate,
    endDate: body.endDate,
    isActive: body.isActive ?? false,
    windowsByDow: body.windowsByDow ?? null,
    breaksByDow: body.breaksByDow ?? null,
    createdAt: new Date().toISOString(),
  };

  try {
    await mutateSemesters(semesters => {
      // Only one semester can be active at a time.
      const next = semester.isActive
        ? semesters.map(s => ({ ...s, isActive: false }))
        : semesters.slice();
      next.push(semester);
      return { semesters: next, result: null };
    });
    return NextResponse.json({ semester }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to save the semester.' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  // Bulk replace all semesters
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!Array.isArray(body?.semesters)) {
    return NextResponse.json({ error: 'semesters array required' }, { status: 400 });
  }
  try {
    await mutateSemesters(() => ({ semesters: body.semesters as SemesterInfo[], result: null }));
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to save semesters.' },
      { status: 500 },
    );
  }
}
