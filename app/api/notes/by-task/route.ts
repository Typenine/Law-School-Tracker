import { countNotesByTask } from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * How many pages are linked to each assignment.
 *
 * The task list needs this for every row at once, so it is one grouped query
 * rather than a lookup per task.
 */
export async function GET() {
  try {
    return noStoreJson({ counts: await countNotesByTask() });
  } catch (error) {
    // The task list is useful without note counts; never break it over this.
    return noStoreJson({ counts: {}, error: error instanceof Error ? error.message : 'Unavailable.' });
  }
}
