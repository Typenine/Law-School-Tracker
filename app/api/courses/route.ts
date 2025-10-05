import { NextRequest } from 'next/server';
import { ensureSchema, listCourses, createCourse, HAS_DB, HAS_BLOB, storageMode } from '@/lib/storage';
import { NewCourseInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const courses = await listCourses();
  return Response.json({ courses, mode: storageMode() });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  // No blocking guard: if neither DB nor Blob is configured in prod, we fall back to JSON file (ephemeral on Vercel).
  const schema = z.object({
    code: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    title: z.string().min(1),
    instructor: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    instructorEmail: z.string().email().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    room: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    location: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    color: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    meetingDays: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    meetingStart: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    meetingEnd: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    meetingBlocks: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)), start: z.string().min(1), end: z.string().min(1), location: z.string().nullable().optional() })).nullable().optional(),
    startDate: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    endDate: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    semester: z.enum(['Spring','Summer','Fall','Winter']).nullable().optional(),
    year: z.number().int().min(2000).max(2100).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'Invalid course body', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data as NewCourseInput;
  const c = await createCourse(body);
  return Response.json({ course: c }, { status: 201 });
}
