import { Pool } from 'pg';
import { COURSE_WORKSPACES_KEY, type CourseWorkspaceMap } from './courseWorkspace';
import type { VersionedWorkspace } from './courseWorkspaceStore';
import { getSettings, patchSettings } from './storage';

type TransactionClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
  release: () => void;
};

type ConnectablePool = Pool & {
  connect: () => Promise<TransactionClient>;
};

function resolveDbUrl() {
  const direct = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (!PGHOST || !PGUSER || !PGPASSWORD || !PGDATABASE) return null;
  const port = PGPORT ? `:${PGPORT}` : '';
  return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${port}/${PGDATABASE}?sslmode=require`;
}

const dbUrl = resolveDbUrl();
let pool: Pool | null = null;
let fallbackQueue: Promise<void> = Promise.resolve();

function getPool() {
  if (!dbUrl) throw new Error('No database connection is configured.');
  if (!pool) pool = new Pool({ connectionString: dbUrl, ssl: dbUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  return pool;
}

function currentFromMap(map: CourseWorkspaceMap, courseId: string) {
  const workspace = (map[courseId] || {}) as VersionedWorkspace;
  return { workspace, revision: Number(workspace._revision || 0) };
}

async function writeWithDatabase(courseId: string, expectedRevision: number, workspace: VersionedWorkspace) {
  const client = await (getPool() as ConnectablePool).connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE', [COURSE_WORKSPACES_KEY]);
    const map = (result.rows[0]?.value || {}) as CourseWorkspaceMap;
    const current = currentFromMap(map, courseId);
    if (current.revision !== expectedRevision) {
      await client.query('ROLLBACK');
      return { conflict: true as const, workspace: current.workspace, revision: current.revision };
    }
    const nextMap = { ...map, [courseId]: workspace };
    await client.query(
      `INSERT INTO settings(key, value) VALUES ($1,$2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [COURSE_WORKSPACES_KEY, JSON.stringify(nextMap)],
    );
    await client.query('COMMIT');
    return { conflict: false as const, workspace, revision: Number(workspace._revision || 0) };
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
}

async function writeWithFallback(courseId: string, expectedRevision: number, workspace: VersionedWorkspace) {
  let result: { conflict: boolean; workspace: VersionedWorkspace; revision: number } | undefined;
  const operation = fallbackQueue.then(async () => {
    const settings = await getSettings([COURSE_WORKSPACES_KEY]);
    const map = (settings[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
    const current = currentFromMap(map, courseId);
    if (current.revision !== expectedRevision) {
      result = { conflict: true, workspace: current.workspace, revision: current.revision };
      return;
    }
    await patchSettings({ [COURSE_WORKSPACES_KEY]: { ...map, [courseId]: workspace } });
    result = { conflict: false, workspace, revision: Number(workspace._revision || 0) };
  });
  fallbackQueue = operation.then(() => undefined, () => undefined);
  await operation;
  if (!result) throw new Error('Course workspace update did not complete.');
  return result;
}

export async function compareAndSwapCourseWorkspace(courseId: string, expectedRevision: number, workspace: VersionedWorkspace) {
  return dbUrl
    ? writeWithDatabase(courseId, expectedRevision, workspace)
    : writeWithFallback(courseId, expectedRevision, workspace);
}
