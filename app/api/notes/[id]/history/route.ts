import { NextRequest } from 'next/server';
import { ensureNotesSchema, notesDb } from '@/lib/notes/db';
import { getAiNote } from '@/lib/notes/pages';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const note = await getAiNote(id);
    if (!note || note.deletedAt) return noStoreJson({ error: 'Note not found' }, { status: 404 });
    await ensureNotesSchema();
    const result = await notesDb().query(
      'SELECT bucket, title, saved_at FROM ai_note_versions WHERE note_id=$1 ORDER BY bucket DESC LIMIT 50', [id]
    );
    return noStoreJson({ versions: result.rows.map((row: { bucket: string | number; title: string; saved_at: string }) => ({ bucket: String(row.bucket), title: row.title, savedAt: row.saved_at })) });
  } catch {
    return noStoreJson({ error: 'Unable to load edit history.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const note = await getAiNote(id);
    if (!note || note.deletedAt) return noStoreJson({ error: 'Note not found' }, { status: 404 });
    const data = await req.json().catch(() => null);
    if (!data || !/^\d{1,16}$/.test(String(data.bucket || ''))) {
      return noStoreJson({ error: 'Invalid revision.' }, { status: 400 });
    }
    await ensureNotesSchema();
    const result = await notesDb().query(
      'SELECT title, content_html FROM ai_note_versions WHERE note_id=$1 AND bucket=$2', [id, data.bucket]
    );
    if (!result.rowCount) return noStoreJson({ error: 'Revision not found.' }, { status: 404 });
    return noStoreJson({ revision: { title: result.rows[0].title, contentHtml: result.rows[0].content_html } });
  } catch {
    return noStoreJson({ error: 'Unable to load revision.' }, { status: 500 });
  }
}
