import { NextRequest } from 'next/server';
import { ensureSchema, updateCourse, deleteCourse } from '@/lib/storage';
import { UpdateCourseInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const schema = z.object({
    code: z.string().trim().nullable().optional().transform(v => v === '' ? null : v),
    title: z.string().min(1).optional(),
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
    overrideEnabled: z.boolean().nullable().optional(),
    overrideMpp: z.number().nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid course patch', { status: 400 });
  const body = parsed.data as UpdateCourseInput;
  const updated = await updateCourse(params.id, body);
  if (!updated) return new Response('Not found', { status: 404 });
  const res = Response.json({ course: updated });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res;
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const ok = await deleteCourse(params.id);
  const res = new Response(ok ? 'ok' : 'not found', { status: ok ? 200 : 404 });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res;
}
