import { NextRequest } from 'next/server';
import { hybridSearchAiNotes, listSectionSubtreeIds } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import type { NoteSearchSort, NoteSourceType } from '@/lib/notes/types';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOURCE_TYPES = new Set<NoteSourceType>([
  'class-notes',
  'reading-notes',
  'case-brief',
  'outline',
  'professor-material',
  'other',
]);
const SORTS = new Set<NoteSearchSort>(['relevance', 'recent', 'oldest', 'class-date']);

export async function GET(req: NextRequest) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const params = req.nextUrl.searchParams;
    const query = params.get('q') || '';
    const requestedLimit = Number(params.get('limit') || 12);
    const sectionId = params.get('sectionId');
    const includeDescendants = params.get('includeDescendants') !== 'false';
    const sourceTypeRaw = params.get('sourceType') as NoteSourceType | null;
    const sortRaw = params.get('sort') as NoteSearchSort | null;
    const gptDb = notesGptDb();
    const sectionIds = sectionId && includeDescendants
      ? await listSectionSubtreeIds(sectionId, gptDb)
      : null;

    const rawMatches = await hybridSearchAiNotes(query, {
      course: params.get('course'),
      semester: params.get('semester'),
      notebookId: params.get('notebookId'),
      section: params.get('section'),
      sectionId: sectionIds?.length ? null : sectionId,
      sectionIds,
      taskId: params.get('taskId'),
      sourceType: sourceTypeRaw && SOURCE_TYPES.has(sourceTypeRaw) ? sourceTypeRaw : null,
      topic: params.get('topic'),
      pinnedOnly: params.get('pinnedOnly') === 'true',
      from: params.get('from'),
      to: params.get('to'),
      sort: sortRaw && SORTS.has(sortRaw) ? sortRaw : 'relevance',
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 12,
    }, gptDb);

    const retrievalMode = rawMatches[0]?.retrievalMode || (process.env.OPENAI_API_KEY?.trim() ? 'hybrid' : 'lexical');
    // Semantic mode deliberately considers notes that do not share literal
    // words with the question. In lexical fallback mode, zero-score rows are
    // merely the wider candidate pool and must not be returned as matches.
    const matches = query.trim() && retrievalMode === 'lexical'
      ? rawMatches.filter(match => match.lexicalScore > 0)
      : rawMatches;

    return noStoreJson({
      query,
      matches,
      count: matches.length,
      retrievalMode,
      searchedSectionIds: sectionIds || (sectionId ? [sectionId] : []),
    });
  } catch (error) {
    console.error('[gpt/notes]', error);
    return noStoreJson({ error: 'Unable to search notes. Try again shortly.' }, { status: 500 });
  }
}
