import { NextRequest } from 'next/server';
import { listAllSections, listNotebooks } from '@/lib/aiNotes';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The shape of the notebook, so the assistant can navigate it.
 *
 * Searching by keyword only goes so far. A question like "what did I write for
 * Evidence in week 3" needs the assistant to know that Evidence is a subject,
 * that it holds categories like Case Briefs, and that weeks sit under those -
 * so it can pick the right sectionId and ask searchNotes for exactly that
 * branch instead of guessing at names.
 */
export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;

  try {
    const [notebooks, sections] = await Promise.all([listNotebooks(), listAllSections()]);

    const branch = (notebookId: string, parentId: string | null): unknown[] =>
      sections
        .filter(s => s.notebookId === notebookId && (s.parentId || null) === parentId)
        .map(s => ({
          id: s.id,
          name: s.name,
          pageCount: s.pageCount,
          sections: branch(notebookId, s.id),
        }));

    return noStoreJson({
      notebooks: notebooks.map(notebook => ({
        id: notebook.id,
        name: notebook.name,
        course: notebook.course,
        semester: notebook.semester,
        archived: notebook.archived,
        pageCount: notebook.noteCount,
        sections: branch(notebook.id, null),
      })),
    });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load notebooks.' },
      { status: 500 },
    );
  }
}
