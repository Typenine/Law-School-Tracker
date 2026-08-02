import { NextResponse } from 'next/server';
import { mutateSemesters, readSemesters } from '@/lib/collections';
import { resolveTerm, termLabel } from '@/lib/semester';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The term the app should be showing right now.
 *
 * Also performs the rollover: `isActive` is a stored flag that goes stale the
 * moment a semester ends, so it is rewritten here to match the term the dates
 * say we are in. That is what makes the app move itself on to the next
 * semester instead of sitting on the previous one.
 */
export async function GET() {
  try {
    const semesters = await readSemesters();
    const term = resolveTerm(semesters);

    const shouldBeActive = term.derived ? null : term.id;
    const stale = semesters.some(s => Boolean(s.isActive) !== (s.id === shouldBeActive));
    if (shouldBeActive && stale) {
      await mutateSemesters(list => ({
        semesters: list.map(s => ({ ...s, isActive: s.id === shouldBeActive })),
        result: null,
      }));
    }

    return NextResponse.json({ term, label: termLabel(term), semesters });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to resolve the current semester.' },
      { status: 500 },
    );
  }
}
