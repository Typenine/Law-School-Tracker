import { parseSyllabusToTasks } from '@/lib/parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as any;
  if (!body || typeof body.text !== 'string') return new Response('Missing text', { status: 400 });
  const text: string = body.text;
  const course: string | null = typeof body.course === 'string' ? body.course : null;
  const mpp = typeof body.minutesPerPage === 'number' && body.minutesPerPage > 0 ? body.minutesPerPage : undefined;
  const tasks = parseSyllabusToTasks(text, course, { minutesPerPage: mpp });
  return Response.json({ tasks });
}
