import { NextRequest, NextResponse } from 'next/server';
import type { SemesterInfo, NewSemesterInput } from '@/lib/types';
import { mutateSemesters, readSemesters, resolveCurrentSemesterState, uid } from '@/lib/collections';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const active = new URL(req.url).searchParams.get('active');
  try {
    let semesters: SemesterInfo[];
    if (active === 'true') {
      const state = await resolveCurrentSemesterState();
      semesters = state.semesters.filter(semester => semester.id === state.term.id);
    } else {
      semesters = await readSemesters();
    }
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

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  try {
    const deleted = await mutateSemesters(semesters => {
      const next = semesters.filter(s => s.id !== id);
      return { semesters: next, result: next.length !== semesters.length };
    });
    if (!deleted) return NextResponse.json({ error: 'Semester not found.' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to delete the semester.' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
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
