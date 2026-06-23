import { NextRequest, NextResponse } from 'next/server';
import { exportFullBackup, restoreFullBackup } from '@/lib/fullBackup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const backup = await exportFullBackup();
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="law-school-tracker-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Backup could not be created.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const backup = await req.json();
    const result = await restoreFullBackup(backup);
    return NextResponse.json({ success: true, result });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Backup could not be restored.' }, { status: 400 });
  }
}
