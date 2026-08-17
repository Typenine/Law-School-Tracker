import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export type WorkspaceBackup = {
  format: 'law-school-tracker-backup';
  version: 1;
  exportedAt: string;
  label?: string | null;
  semesterId?: string | null;
  tables: Record<string, unknown[]>;
};

export type WorkspaceArchive = {
  id: string;
  semesterId: string | null;
  name: string;
  createdAt: string;
  snapshot: WorkspaceBackup;
};

function databaseUrl(): string | null {
  const direct = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (!PGHOST || !PGUSER || !PGPASSWORD || !PGDATABASE) return null;
  return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${PGPORT ? `:${PGPORT}` : ''}/${PGDATABASE}?sslmode=require`;
}

const DB_URL = databaseUrl();
let pool: Pool | null = null;
function db(): Pool {
  if (!DB_URL) throw new Error('Workspace backup requires Postgres.');
  if (!pool) pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  return pool;
}

const EXACT_TABLES = new Set([
  'courses', 'tasks', 'sessions', 'schedule_blocks', 'settings', 'app_settings',
  'calendar_events', 'events', 'course_documents', 'task_v2_meta', 'semesters',
  'collections', 'kv_store', 'ai_notes',
]);
const PREFIXES = ['ai_note_'];
const EXCLUDED = new Set(['workspace_archives', 'ai_note_embedding_chunks']);
const RESTORE_ORDER = [
  'courses', 'semesters', 'collections', 'settings', 'app_settings', 'kv_store',
  'tasks', 'task_v2_meta', 'sessions', 'schedule_blocks', 'calendar_events', 'events',
  'course_documents', 'ai_note_notebooks', 'ai_note_sections', 'ai_notes', 'ai_note_migrations',
];

function allowedTable(name: string): boolean {
  if (EXCLUDED.has(name)) return false;
  return EXACT_TABLES.has(name) || PREFIXES.some(prefix => name.startsWith(prefix));
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function ensureWorkspaceArchiveSchema(): Promise<void> {
  await db().query(`
    CREATE TABLE IF NOT EXISTS workspace_archives (
      id uuid PRIMARY KEY,
      semester_id text,
      name text NOT NULL,
      snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db().query(`CREATE INDEX IF NOT EXISTS workspace_archives_created_idx ON workspace_archives (created_at DESC)`);
}

async function availableTables(): Promise<string[]> {
  const result = await db().query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map(row => String(row.table_name)).filter(allowedTable);
}

export async function createWorkspaceBackup(options?: { label?: string | null; semesterId?: string | null }): Promise<WorkspaceBackup> {
  const tables: Record<string, unknown[]> = {};
  for (const table of await availableTables()) {
    const result = await db().query(`SELECT * FROM ${quoteIdent(table)}`);
    tables[table] = result.rows;
  }
  return {
    format: 'law-school-tracker-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    label: options?.label ?? null,
    semesterId: options?.semesterId ?? null,
    tables,
  };
}

function validBackup(value: any): value is WorkspaceBackup {
  return value?.format === 'law-school-tracker-backup'
    && value?.version === 1
    && value?.tables
    && typeof value.tables === 'object'
    && !Array.isArray(value.tables);
}

async function primaryKeyColumns(table: string): Promise<string[]> {
  const result = await db().query(`
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `, [table]);
  return result.rows.map(row => String(row.column_name));
}

async function tableColumns(table: string): Promise<string[]> {
  const result = await db().query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return result.rows.map(row => String(row.column_name));
}

export async function restoreWorkspaceBackup(value: unknown): Promise<{ restored: Record<string, number>; skipped: string[] }> {
  if (!validBackup(value)) throw new Error('This is not a valid Law School Tracker backup.');
  const current = new Set(await availableTables());
  const supplied = Object.keys(value.tables).filter(allowedTable);
  const ordered = [...RESTORE_ORDER.filter(name => supplied.includes(name)), ...supplied.filter(name => !RESTORE_ORDER.includes(name)).sort()];
  const restored: Record<string, number> = {};
  const skipped: string[] = [];
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    for (const table of ordered) {
      const rows = value.tables[table];
      if (!Array.isArray(rows) || !rows.length) continue;
      if (!current.has(table)) { skipped.push(table); continue; }
      const columns = await tableColumns(table);
      const pk = await primaryKeyColumns(table);
      if (!columns.length || !pk.length) { skipped.push(table); continue; }
      const updateColumns = columns.filter(column => !pk.includes(column));
      const conflict = `ON CONFLICT (${pk.map(quoteIdent).join(', ')}) DO ${updateColumns.length
        ? `UPDATE SET ${updateColumns.map(column => `${quoteIdent(column)}=EXCLUDED.${quoteIdent(column)}`).join(', ')}`
        : 'NOTHING'}`;
      const sql = `INSERT INTO ${quoteIdent(table)} SELECT * FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json) ${conflict}`;
      const result = await client.query(sql, [JSON.stringify(rows)]);
      restored[table] = result.rowCount || rows.length;
    }
    await client.query('COMMIT');
    return { restored, skipped };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createWorkspaceArchive(input: { semesterId?: string | null; name: string }): Promise<WorkspaceArchive> {
  await ensureWorkspaceArchiveSchema();
  const id = randomUUID();
  const snapshot = await createWorkspaceBackup({ label: input.name, semesterId: input.semesterId ?? null });
  const result = await db().query(
    `INSERT INTO workspace_archives (id, semester_id, name, snapshot) VALUES ($1,$2,$3,$4::jsonb) RETURNING id, semester_id, name, snapshot, created_at`,
    [id, input.semesterId ?? null, input.name.trim(), JSON.stringify(snapshot)],
  );
  const row = result.rows[0];
  return { id: String(row.id), semesterId: row.semester_id ?? null, name: String(row.name), snapshot: row.snapshot as WorkspaceBackup, createdAt: new Date(row.created_at).toISOString() };
}

export async function listWorkspaceArchives(): Promise<Array<Omit<WorkspaceArchive, 'snapshot'> & { exportedAt: string }>> {
  await ensureWorkspaceArchiveSchema();
  const result = await db().query(`SELECT id, semester_id, name, created_at, snapshot->>'exportedAt' AS exported_at FROM workspace_archives ORDER BY created_at DESC`);
  return result.rows.map(row => ({ id: String(row.id), semesterId: row.semester_id ?? null, name: String(row.name), createdAt: new Date(row.created_at).toISOString(), exportedAt: String(row.exported_at || row.created_at) }));
}

export async function getWorkspaceArchive(id: string): Promise<WorkspaceArchive | null> {
  await ensureWorkspaceArchiveSchema();
  const result = await db().query(`SELECT id, semester_id, name, snapshot, created_at FROM workspace_archives WHERE id=$1`, [id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: String(row.id), semesterId: row.semester_id ?? null, name: String(row.name), snapshot: row.snapshot as WorkspaceBackup, createdAt: new Date(row.created_at).toISOString() };
}

export async function deleteWorkspaceArchive(id: string): Promise<boolean> {
  await ensureWorkspaceArchiveSchema();
  const result = await db().query(`DELETE FROM workspace_archives WHERE id=$1`, [id]);
  return (result.rowCount || 0) > 0;
}
