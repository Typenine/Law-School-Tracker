import { NextRequest, NextResponse } from 'next/server';
import { runAcademicMaintenance } from '@/lib/academicMaintenance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runAcademicMaintenance();
    return NextResponse.json({ success: true, result });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Academic maintenance failed.' }, { status: 500 });
  }
}
