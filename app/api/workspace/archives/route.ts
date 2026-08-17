import { NextRequest } from 'next/server';
import { createWorkspaceArchive, listWorkspaceArchives } from '@/lib/workspaceBackup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json({ archives: await listWorkspaceArchives() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[workspace archives]', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to list archives.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body?.name || '').trim();
    if (!name) return Response.json({ error: 'Archive name is required.' }, { status: 400 });
    const archive = await createWorkspaceArchive({ name, semesterId: body?.semesterId ? String(body.semesterId) : null });
    return Response.json({ archive: { id: archive.id, semesterId: archive.semesterId, name: archive.name, createdAt: archive.createdAt, exportedAt: archive.snapshot.exportedAt } }, { status: 201 });
  } catch (error) {
    console.error('[workspace archive create]', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create archive.' }, { status: 500 });
  }
}
