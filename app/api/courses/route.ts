import { NextRequest } from 'next/server';
import { ensureSchema, listCourses, createCourse } from '@/lib/storage';
import { NewCourseInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const courses = await listCourses();
  return Response.json({ courses });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const schema = z.object({
    code: z.string().trim().min(1).nullable().optional(),
    title: z.string().min(1),
    instructor: z.string().trim().min(1).nullable().optional(),
    instructorEmail: z.string().email().nullable().optional(),
    room: z.string().trim().min(1).nullable().optional(),
    location: z.string().trim().min(1).nullable().optional(),
    meetingDays: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    meetingStart: z.string().trim().min(1).nullable().optional(),
    meetingEnd: z.string().trim().min(1).nullable().optional(),
    meetingBlocks: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)), start: z.string().min(1), end: z.string().min(1), location: z.string().nullable().optional() })).nullable().optional(),
    startDate: z.string().trim().min(1).nullable().optional(),
    endDate: z.string().trim().min(1).nullable().optional(),
    semester: z.enum(['Spring','Summer','Fall','Winter']).nullable().optional(),
    year: z.number().int().min(2000).max(2100).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid course body', { status: 400 });
  const body = parsed.data as NewCourseInput;
  const c = await createCourse(body);
  return Response.json({ course: c }, { status: 201 });
}
