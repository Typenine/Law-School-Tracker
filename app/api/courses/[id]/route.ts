import { NextRequest } from 'next/server';
import { ensureSchema, updateCourse, deleteCourse } from '@/lib/storage';
import { UpdateCourseInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const schema = z.object({
    code: z.string().trim().min(1).nullable().optional(),
    title: z.string().min(1).optional(),
    instructor: z.string().trim().min(1).nullable().optional(),
    instructorEmail: z.string().email().nullable().optional(),
    room: z.string().trim().min(1).nullable().optional(),
    location: z.string().trim().min(1).nullable().optional(),
    color: z.string().trim().min(1).nullable().optional(),
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
  if (!parsed.success) return new Response('Invalid course patch', { status: 400 });
  const body = parsed.data as UpdateCourseInput;
  const updated = await updateCourse(params.id, body);
  if (!updated) return new Response('Not found', { status: 404 });
  return Response.json({ course: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const ok = await deleteCourse(params.id);
  return new Response(ok ? 'ok' : 'not found', { status: ok ? 200 : 404 });
}
