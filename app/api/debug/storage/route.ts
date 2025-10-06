import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { list } from '@vercel/blob';
import { HAS_DB, HAS_BLOB, storageMode } from '@/lib/storage';
import { listCourses } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function envBool(v: any): boolean { return !!v && String(v).toLowerCase() !== 'false' && String(v) !== '0'; }

export async function GET(_req: NextRequest) {
  const details: any = {
    env: {
      vercel: envBool(process.env.VERCEL),
      nodeEnv: process.env.NODE_ENV || null,
    },
    flags: {
      HAS_DB,
      HAS_BLOB,
      mode: storageMode(),
    },
    db: { available: false as boolean, courseCount: null as number | null, error: null as string | null },
    blob: { available: false as boolean, keys: [] as string[], dbjson: null as any, error: null as string | null },
    api: { coursesCount: null as number | null, error: null as string | null },
  };

  // API view (what the app returns via listCourses)
  try {
    const apiCourses = await listCourses();
    details.api.coursesCount = Array.isArray(apiCourses) ? apiCourses.length : null;
  } catch (e: any) {
    details.api.error = e?.message || String(e);
  }

  // DB view
  try {
    const url = process.env.DATABASE_URL;
    if (url) {
      const pool = new Pool({ connectionString: url, ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
      const res = await pool.query('SELECT COUNT(*)::int AS n FROM courses');
      details.db.available = true;
      details.db.courseCount = res.rows?.[0]?.n ?? null;
      await pool.end().catch(() => {});
    }
  } catch (e: any) {
    details.db.error = e?.message || String(e);
  }

  // Blob view
  try {
    const { blobs } = await list();
    details.blob.available = true;
    details.blob.keys = blobs.map((b: any) => b.pathname);
    const dbj = blobs.find((b: any) => (b.pathname || '') === 'db.json')
      || blobs.find((b: any) => (b.pathname || '').endsWith('/db.json'))
      || blobs.filter((b: any) => (b.pathname || '').startsWith('db.json-')).sort((a: any, b: any) => new Date(b.uploadedAt || b.createdAt || b.lastModified || 0).getTime() - new Date(a.uploadedAt || a.createdAt || a.lastModified || 0).getTime())[0];
    if (dbj?.url) {
      const res = await fetch(`${dbj.url}?_ts=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json().catch(() => null as any);
        details.blob.dbjson = {
          path: dbj.pathname,
          size: dbj.size || null,
          hasRev: json && typeof json.__rev === 'number' ? true : false,
          rev: json?.__rev ?? null,
          coursesCount: Array.isArray(json?.courses) ? json.courses.length : null,
        };
      } else {
        details.blob.dbjson = { path: dbj.pathname, error: `HTTP ${res.status}` };
      }
    }
  } catch (e: any) {
    details.blob.error = e?.message || String(e);
  }

  const res = Response.json(details);
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('CDN-Cache-Control', 'no-store');
  res.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}
