import { NextRequest } from 'next/server';
import { searchAiNotes } from '@/lib/aiNotes';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;

  try {
    const params = req.nextUrl.searchParams;
    const query = params.get('q') || '';
    const requestedLimit = Number(params.get('limit') || 12);
    const matches = await searchAiNotes(query, {
      course: params.get('course'),
      semester: params.get('semester'),
      from: params.get('from'),
      to: params.get('to'),
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 12,
    });
    return noStoreJson({ query, matches, count: matches.length });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to search notes.' },
      { status: 500 },
    );
  }
}
