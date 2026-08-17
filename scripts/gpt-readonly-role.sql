-- Read-only Postgres role for the ChatGPT connector's READ operations.
--
-- Search, retrieval, workspace overview, assignments, courses, sessions and
-- notebook navigation use GPT_DATABASE_URL when it is configured. The narrow
-- write actions (create a study note, append to a note, link an assignment)
-- intentionally use the application's normal database connection instead and
-- are separately constrained by their route handlers. There is no GPT delete
-- action.
--
-- Run this once against production after filling in a real password, then set
-- GPT_DATABASE_URL in Vercel to a connection string using this role on the same
-- host/database as DATABASE_URL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'law_school_gpt_ro') THEN
    CREATE ROLE law_school_gpt_ro LOGIN PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE current_database() TO law_school_gpt_ro;
GRANT USAGE ON SCHEMA public TO law_school_gpt_ro;

-- Exactly the user-data tables needed by connector reads. The semantic-search
-- embedding cache is derived data and is managed through the normal app role,
-- so this SELECT-only role does not need access to it.
GRANT SELECT ON
  tasks,
  courses,
  sessions,
  ai_notes,
  ai_note_notebooks,
  ai_note_sections
TO law_school_gpt_ro;
