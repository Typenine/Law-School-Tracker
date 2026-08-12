-- Read-only Postgres role for the ChatGPT connector (app/api/gpt/*).
--
-- The connector's routes are all read-only in application code already, but
-- that is only a guarantee until the next bug. This role makes it a
-- guarantee the database enforces: even a coding mistake that tried to
-- INSERT/UPDATE/DELETE through this role would be rejected by Postgres.
--
-- Run this once against your production database (e.g. via the Neon /
-- Supabase / Vercel Postgres SQL console, or `psql "$DATABASE_URL" -f
-- scripts/gpt-readonly-role.sql` after filling in a real password below).
-- Then set GPT_DATABASE_URL in your Vercel project to a connection string
-- using this role's credentials, on the same host/database as DATABASE_URL.
--
-- Safe to re-run: CREATE ROLE is the only non-idempotent statement, guarded
-- below. Everything else (GRANT) can be re-applied freely, which also means
-- re-running this after adding a new table the connector should read is the
-- way to extend its access.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'law_school_gpt_ro') THEN
    CREATE ROLE law_school_gpt_ro LOGIN PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE current_database() TO law_school_gpt_ro;
GRANT USAGE ON SCHEMA public TO law_school_gpt_ro;

-- Exactly the tables the GPT connector's routes read from. Not settings,
-- schedule_blocks, or ai_note_migrations - the connector never touches those.
GRANT SELECT ON
  tasks,
  courses,
  sessions,
  ai_notes,
  ai_note_notebooks,
  ai_note_sections
TO law_school_gpt_ro;

-- No sequences to grant: every id here is a client-generated UUID, and this
-- role never writes anyway.
