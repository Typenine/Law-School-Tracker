import { NextRequest, NextResponse } from 'next/server';
import type { SemesterInfo, NewSemesterInput } from '@/lib/types';

const SETTING_KEY = 'semestersV1';

async function getSemesters(): Promise<SemesterInfo[]> {
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/settings?keys=${SETTING_KEY}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    const semesters = data?.settings?.[SETTING_KEY];
    return Array.isArray(semesters) ? semesters : [];
  } catch {
    return [];
  }
}

async function saveSemesters(semesters: SemesterInfo[]): Promise<void> {
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [SETTING_KEY]: semesters }),
    });
  } catch {}
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const active = url.searchParams.get('active');
  
  let semesters = await getSemesters();
  
  if (active === 'true') {
    semesters = semesters.filter(s => s.isActive);
  }
  
  // Sort by start date descending (most recent first)
  semesters.sort((a, b) => b.startDate.localeCompare(a.startDate));
  
  return NextResponse.json({ semesters });
}

export async function POST(req: NextRequest) {
  try {
    const body: NewSemesterInput = await req.json();
    if (!body.name || !body.season || !body.year || !body.startDate || !body.endDate) {
      return NextResponse.json({ error: 'name, season, year, startDate, and endDate are required' }, { status: 400 });
    }
    
    const semester: SemesterInfo = {
      id: uid(),
      name: body.name,
      season: body.season,
      year: body.year,
      startDate: body.startDate,
      endDate: body.endDate,
      isActive: body.isActive ?? false,
      windowsByDow: body.windowsByDow ?? null,
      breaksByDow: body.breaksByDow ?? null,
      createdAt: new Date().toISOString(),
    };
    
    const semesters = await getSemesters();
    
    // If setting as active, deactivate others
    if (semester.isActive) {
      for (const s of semesters) {
        s.isActive = false;
      }
    }
    
    semesters.push(semester);
    await saveSemesters(semesters);
    
    return NextResponse.json({ semester }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  // Bulk replace all semesters
  try {
    const body = await req.json();
    if (!Array.isArray(body.semesters)) {
      return NextResponse.json({ error: 'semesters array required' }, { status: 400 });
    }
    await saveSemesters(body.semesters);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
