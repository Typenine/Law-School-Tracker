import { NextRequest } from 'next/server';
import { searchAiNotes } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const params = req.nextUrl.searchParams;
    const query = params.get('q') || '';
    const requestedLimit = Number(params.get('limit') || 12);
    const matches = await searchAiNotes(query, {
      course: params.get('course'),
      semester: params.get('semester'),
      // The hierarchy the workspace uses, so the assistant can be asked for
      // "the Evidence case briefs from week 3" rather than just a course.
      notebookId: params.get('notebookId'),
      section: params.get('section'),
      sectionId: params.get('sectionId'),
      // Lets the assistant go from a reading assignment to the notes on it.
      taskId: params.get('taskId'),
      from: params.get('from'),
      to: params.get('to'),
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 12,
    }, notesGptDb());
    return noStoreJson({ query, matches, count: matches.length });
  } catch (error) {
    console.error('[gpt/notes]', error);
    return noStoreJson({ error: 'Unable to search notes. Try again shortly.' }, { status: 500 });
  }
}
