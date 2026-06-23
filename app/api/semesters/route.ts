import { NextRequest, NextResponse } from 'next/server';
import type { SemesterInfo, NewSemesterInput } from '@/lib/types';
import { getOrInitializeSemesters, saveSemesters } from '@/lib/semesterStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function validateSemesterList(value: unknown): value is SemesterInfo[] {
  return Array.isArray(value) && value.every(item =>
    item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.startDate === 'string' &&
    typeof item.endDate === 'string'
  );
}

export async function GET(req: NextRequest) {
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true';
  let semesters = await getOrInitializeSemesters();
  if (activeOnly) semesters = semesters.filter(semester => semester.isActive);
  semesters = semesters.slice().sort((a, b) => b.startDate.localeCompare(a.startDate));
  return NextResponse.json({ semesters });
}

export async function POST(req: NextRequest) {
  try {
    const body: NewSemesterInput = await req.json();
    if (!body.name || !body.season || !body.year || !body.startDate || !body.endDate) {
      return NextResponse.json({ error: 'name, season, year, startDate, and endDate are required' }, { status: 400 });
    }
    if (body.endDate < body.startDate) {
      return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 });
    }

    const semesters = await getOrInitializeSemesters();
    const duplicate = semesters.find(semester => semester.season === body.season && semester.year === body.year);
    if (duplicate) {
      return NextResponse.json({ error: `${body.season} ${body.year} already exists`, semester: duplicate }, { status: 409 });
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

    if (semester.isActive) {
      for (const existing of semesters) existing.isActive = false;
    }
    semesters.push(semester);
    await saveSemesters(semesters);
    return NextResponse.json({ semester }, { status: 201 });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Invalid request' }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!validateSemesterList(body.semesters)) {
      return NextResponse.json({ error: 'valid semesters array required' }, { status: 400 });
    }
    const active = body.semesters.filter((semester: SemesterInfo) => semester.isActive);
    if (active.length > 1) {
      return NextResponse.json({ error: 'Only one semester can be active' }, { status: 400 });
    }
    await saveSemesters(body.semesters);
    return NextResponse.json({ success: true, semesters: body.semesters });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Invalid request' }, { status: 400 });
  }
}
