import { ensureSchema } from '@/lib/storage';
import { statsNowV2 } from '@/lib/statsV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const stats = await statsNowV2();
  return Response.json(stats);
}
