import { NextRequest } from 'next/server';
import { ensureSchema, getSettings, patchSettings } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await ensureSchema();
  const url = new URL(req.url);
  const keysParam = url.searchParams.get('keys');
  if (keysParam) {
    const keys = keysParam.split(',').map(s => s.trim()).filter(Boolean);
    const subset = await getSettings(keys);
    return Response.json({ settings: subset });
  }
  const all = await getSettings();
  return Response.json({ settings: all });
}

export async function PATCH(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return new Response('Invalid settings body', { status: 400 });
  await patchSettings(body as Record<string, any>);
  return new Response(null, { status: 204 });
}
