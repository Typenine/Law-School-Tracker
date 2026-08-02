import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import pg from 'pg';

/**
 * Boot the real app against a real Postgres for the duration of a test file.
 *
 * These are deliberately not unit tests. Every notes bug worth catching so far
 * has been about what the database actually does - a migration that recreated
 * deleted sections on boot, a section_id left pointing at a deleted row, a
 * filter that quietly narrowed a search - and none of them would survive
 * contact with a mocked query layer. So the tests drive the same HTTP API the
 * browser does, against the same schema, on the same Postgres.
 */

const GPT_TOKEN = 'test-gpt-token';
const READY_TIMEOUT_MS = 60_000;

function connectionString() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'These tests need Postgres. Set DATABASE_URL to a database you do not mind being '
      + 'wiped, e.g. DATABASE_URL=postgres://postgres@127.0.0.1:5432/lst_test npm test',
    );
  }
  return url;
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

/** Spawn `next start` on a fixed port and wait until it answers. */
async function spawnApp(port, url) {
  const child = spawn('node_modules/.bin/next', ['start', '-p', String(port)], {
    env: { ...process.env, DATABASE_URL: url, LAW_SCHOOL_GPT_TOKEN: GPT_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const log = [];
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  let exited = false;
  child.on('exit', () => { exited = true; });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (exited) throw new Error(`The app exited before it was ready:\n${log.join('')}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/notes`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`The app did not start within 60s. Did you run "npm run build"?\n${log.join('')}`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return {
    child,
    async kill() {
      if (exited) return;
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 5000))]);
      if (!exited) child.kill('SIGKILL');
    },
  };
}

/** Every table the notes feature owns. */
const NOTES_TABLES = ['ai_notes', 'ai_note_sections', 'ai_note_notebooks'];

export async function startApp() {
  const url = connectionString();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const db = new pg.Pool({ connectionString: url });
  let running = await spawnApp(port, url);

  return {
    base,
    db,
    token: GPT_TOKEN,

    /** JSON request helper. Returns the status alongside the parsed body. */
    async api(method, path, body, headers = {}) {
      const response = await fetch(base + path, {
        method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, body: data, text };
    },

    /** The same, with the GPT bearer token attached. */
    gpt(path, headers = {}) {
      return this.api('GET', path, undefined, { Authorization: `Bearer ${GPT_TOKEN}`, ...headers });
    },

    /** Empty the notes tables so each test starts from nothing. */
    async reset() {
      for (const table of NOTES_TABLES) {
        await db.query(`TRUNCATE TABLE ${table} CASCADE`).catch(error => {
          // A table that does not exist yet is fine: the app creates it on boot.
          if (error?.code !== '42P01') throw error;
        });
      }
    },

    /**
     * Restart against the same database. Migrations only run on boot, so
     * anything that claims to be fixed "next time the server starts" has to be
     * proved by actually starting again.
     */
    async restart() {
      await running.kill();
      running = await spawnApp(port, url);
    },

    async stop() {
      await running.kill();
      await db.end().catch(() => {});
    },
  };
}
