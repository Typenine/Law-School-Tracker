import { NextRequest } from 'next/server';
import { getAiNote, updateAiNote } from '@/lib/aiNotes';
import { ensureSchema, listTasks } from '@/lib/storage';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const taskId = body.taskId == null || String(body.taskId).trim() === '' ? null : String(body.taskId).trim();
    const current = await getAiNote((await context.params).id);
    if (!current || current.deletedAt || current.archived) {
      return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    }

    if (taskId) {
      await ensureSchema();
      const tasks = await listTasks();
      if (!tasks.some(task => String(task.id) === taskId)) {
        return noStoreJson({ error: 'Assignment not found.' }, { status: 404 });
      }
    }

    const note = await updateAiNote((await context.params).id, {
      taskId,
      expectedUpdatedAt: current.updatedAt,
    });
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    return noStoreJson({ note });
  } catch (error: any) {
    if (error?.name === 'NoteConflictError') {
      return noStoreJson({ error: error.message }, { status: 409 });
    }
    console.error('[gpt/notes/[id]/link-assignment]', error);
    return noStoreJson({ error: 'Unable to link that assignment. Try again shortly.' }, { status: 500 });
  }
}
