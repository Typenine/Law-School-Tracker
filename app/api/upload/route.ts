export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  return new Response('Gone', { status: 410 });
}
