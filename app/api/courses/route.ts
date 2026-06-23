import { NextRequest } from 'next/server';
import { ensureSchema, listCourses, createCourse, storageMode, migrateCoursesToDbIfEmpty } from '@/lib/storage';
import { ensureTaskCourseIdsBackfilled } from '@/lib/taskCourseMigration';
import { NewCourseInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  try { await migrateCoursesToDbIfEmpty(); } catch {}
  try { await ensureTaskCourseIdsBackfilled(); } catch {}
  const courses = await listCourses();
  const res = Response.json({ courses, mode: storageMode() });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('CDN-Cache-Control', 'no-store');
  res.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

export async function POST(req: NextRequest) {
  await ensureSchema();
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
  if (!parsed.success) return Response.json({ error: 'Invalid course body', issues: parsed.error.issues }, { status: 400 });
  const course = await createCourse(parsed.data as NewCourseInput);
  const res = Response.json({ course }, { status: 201 });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('CDN-Cache-Control', 'no-store');
  res.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}
