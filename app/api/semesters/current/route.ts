import { NextResponse } from 'next/server';
import { resolveCurrentSemesterState } from '@/lib/collections';
import { termLabel } from '@/lib/semester';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const { term, semesters } = await resolveCurrentSemesterState();
    return NextResponse.json({ term, label: termLabel(term), semesters });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to resolve the current semester.' },
      { status: 500 },
    );
  }
}
