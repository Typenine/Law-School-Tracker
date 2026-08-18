import { NextRequest } from 'next/server';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '@/lib/workspaceBackup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const backup = await createWorkspaceBackup();
    const stamp = backup.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="law-school-tracker-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[workspace backup]', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create backup.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await restoreWorkspaceBackup(body?.backup ?? body);
    return Response.json({ restored: true, ...result });
  } catch (error) {
    console.error('[workspace restore]', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore backup.' }, { status: 400 });
  }
}
