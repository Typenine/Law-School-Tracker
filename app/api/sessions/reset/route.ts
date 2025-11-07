import { ensureSchema, resetAllSessions } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  await ensureSchema();
  const removed = await resetAllSessions();
  return Response.json({ removed });
}
