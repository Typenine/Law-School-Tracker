import { NextRequest } from 'next/server';
import { deleteWorkspaceArchive, getWorkspaceArchive, restoreWorkspaceBackup } from '@/lib/workspaceBackup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const archive = await getWorkspaceArchive((await context.params).id);
    if (!archive) return Response.json({ error: 'Archive not found.' }, { status: 404 });
    return new Response(JSON.stringify(archive.snapshot, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${archive.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}-archive.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to read archive.' }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const archive = await getWorkspaceArchive((await context.params).id);
    if (!archive) return Response.json({ error: 'Archive not found.' }, { status: 404 });
    const result = await restoreWorkspaceBackup(archive.snapshot);
    return Response.json({ restored: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore archive.' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const deleted = await deleteWorkspaceArchive((await context.params).id);
    return deleted ? new Response(null, { status: 204 }) : Response.json({ error: 'Archive not found.' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete archive.' }, { status: 500 });
  }
}
