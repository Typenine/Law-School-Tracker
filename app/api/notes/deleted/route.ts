import { NextRequest } from 'next/server';
import {
  TRASH_RETENTION_DAYS,
  listArchivedNotes,
  listTrashedNotes,
  purgeExpiredNotes,
  restoreAiNote,
} from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Pages that have been set aside: the trash, and anything archived. */
export async function GET() {
  try {
    // Nothing runs on a timer here, so the sweep happens when the trash is
    // opened - the same moment the user is shown the retention window.
    await purgeExpiredNotes().catch(() => 0);
    const [trashed, archived] = await Promise.all([listTrashedNotes(), listArchivedNotes()]);
    return noStoreJson({ trashed, archived, retentionDays: TRASH_RETENTION_DAYS });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load set-aside pages.' },
      { status: 500 },
    );
  }
}

/** Bring a page back from the trash, or out of the archive. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return noStoreJson({ error: 'A page id is required.' }, { status: 400 });
    const note = await restoreAiNote(id);
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    return noStoreJson({ note });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to restore the page.' },
      { status: 500 },
    );
  }
}

/** Empty the trash now, rather than waiting out the retention window. */
export async function DELETE() {
  try {
    const purged = await purgeExpiredNotes({ all: true });
    return noStoreJson({ purged });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to empty the trash.' },
      { status: 500 },
    );
  }
}
