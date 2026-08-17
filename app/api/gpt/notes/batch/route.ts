import { NextRequest } from 'next/server';
import { getAiNote, getSectionPaths } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_NOTES = 8;

export async function GET(req: NextRequest) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const raw = req.nextUrl.searchParams.get('ids') || '';
    const ids = Array.from(new Set(raw.split(',').map(value => value.trim()).filter(Boolean))).slice(0, MAX_NOTES);
    if (!ids.length) return noStoreJson({ error: 'Provide at least one note id in ids.' }, { status: 400 });

    const gptDb = notesGptDb();
    const loaded = await Promise.all(ids.map(id => getAiNote(id, gptDb)));
    const active = loaded.filter(note => note && !note.deletedAt && !note.archived);
    const paths = await getSectionPaths(active.map(note => note?.sectionId), gptDb);

    const notes = active.map(note => {
      if (!note) return null;
      const { contentHtml, ...readable } = note;
      const sectionPath = note.sectionId ? (paths.get(note.sectionId) || []) : [];
      const locationPath = [note.notebookName || note.course, ...sectionPath].filter(Boolean).join(' / ');
      const images = Array.from(String(contentHtml || '').matchAll(/<img[^>]+src="([^"]+)"/gi)).map(match => match[1]);
      return { ...readable, locationPath, images };
    }).filter(Boolean);

    return noStoreJson({ notes, count: notes.length, requestedCount: ids.length });
  } catch (error) {
    console.error('[gpt/notes/batch]', error);
    return noStoreJson({ error: 'Unable to load those notes. Try again shortly.' }, { status: 500 });
  }
}
