import { ensureSchema, statsNow } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const stats = await statsNow();
  return Response.json(stats);
}
