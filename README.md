# Law School Tracker (Next.js on Vercel)

A simple app to help you stay on track with readings and assignments and log study sessions.

## Features
- Backlog Quick Add and filters (status, course)
- Task dashboard: due dates, status, quick complete/delete
- Export tasks to calendar via ICS download
- Log study sessions with minutes, focus level (1-10), notes (CSV import supported)
- Stats: upcoming tasks, hours this week, focus average
- Planner page: next 7 days grouped by date
- Upload and search law-school notes for a private custom GPT Action
- Storage: Postgres via `DATABASE_URL` on Vercel; JSON file locally for dev
  
Extras:
- Inline editing for tasks (title/course/due/estimated minutes)
- Focus Timer to track a session and save it
- Optional weekly hours goal with progress bar

## Quickstart (Local)
1. Prereqs: Node 18.17+
2. Install deps:
   ```bash
   npm install
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
4. Open http://localhost:3000

By default, data is stored in `data/db.json` (created on first write). This file is not suitable for Vercel (read-only FS), use Postgres in prod.

## Tests

The notes tests drive the real HTTP API against a real Postgres, because the
bugs worth catching there are about what the database actually does — a
migration that recreated deleted sections on boot, a page left pointing at a
deleted section, a search that quietly narrowed itself. Point `DATABASE_URL` at
a database you do not mind being wiped:

```bash
npm run build                     # the tests start the built app
DATABASE_URL=postgres://postgres@127.0.0.1:5432/lst_test npm test
```

`npm run typecheck` runs TypeScript on its own. CI runs all three on every push
and pull request.

## Configure Postgres (Prod)
- Set `DATABASE_URL` in Vercel Project Settings → Environment Variables
- The app auto-creates the required tables on first use.

## Deploy to Vercel
- Push this repo to GitHub/GitLab/Bitbucket
- Import to Vercel → Framework: Next.js → set `DATABASE_URL` if using Postgres → Deploy

## Law School GPT Action

The Notes page can extract and store text from PDF, DOCX, TXT, and Markdown files. The original uploaded file is not retained. Notes are stored in Postgres and searched through protected, read-only GPT endpoints.

Set these Vercel environment variables before using the feature:

- `LAW_SCHOOL_GPT_TOKEN`: bearer token used by the custom GPT Action. This token has read-only access to courses, assignments, and notes.
- `BLOB_READ_WRITE_TOKEN`: set by binding Vercel Blob to the project. Without it, images cannot be added to notes; everything else works, and the editor says why.

The Notes page itself needs no token — it uses the same access model as the rest of the tracker.

After deployment:

1. Copy the OpenAPI schema URL shown on the Notes page.
2. In the custom GPT builder, add an Action using that schema URL.
3. Configure Action authentication as an API key sent with Bearer authentication, using `LAW_SCHOOL_GPT_TOKEN`.

The GPT Action exposes only these read operations:

- List courses
- Filter assignments by status, course, or date range
- List notebooks with their nested sections, so the assistant can navigate the hierarchy
- Search notes by topic, course, semester, class date, notebook, or section
- Retrieve the full text of a selected note

## Import Sessions (CSV)
- Use Settings → Import Data (CSV) to import study sessions with mapping, preview, deduplication, and append/replace modes.

## ICS Export (Calendar)
- Use the "Download .ics" button in the Tasks card (homepage) or visit `/api/export/ics` directly.
- Import the resulting `law-school-tasks.ics` into Google Calendar, Apple Calendar, or Outlook.
- Events are all-day on the task due date.

### Filters
- You can filter what is exported using query params:
  - `course=` substring match, e.g. `/api/export/ics?course=Contracts`
  - `status=` `todo` or `done`, e.g. `/api/export/ics?status=todo`
- The Tasks UI "Download .ics" link respects the current filters.

### Private Token (optional)
- If you set `ICS_PRIVATE_TOKEN` in environment variables, exporting requires `?token=YOUR_TOKEN`.
- Example subscription URL: `https://<your-site>/api/export/ics?token=YOUR_TOKEN&status=todo`.

## Planner (Next 7 Days)
- Visit `/planner` or use the "Planner" nav link.
- Tasks are grouped by day; each card shows title, course, time, and status.

## Estimated Minutes
- You can set estimated minutes when adding tasks or edit them inline in the Tasks table.

## Focus Timer
- Start/Pause/Resume a timer and save the session to `/api/sessions` with rounded minutes and optional focus score.
- Optionally associate the session with an existing task.

## Weekly Goal (Stats)
- In the Stats card, set your weekly study-hour goal. It's saved in `localStorage`.
- Progress shows `hoursThisWeek / goal` as a percentage bar.

## Settings
- Visit `/settings` to configure:
  - Default focus (1-5) used by Focus Timer/Session Logger
  - Reminders (enable and lead hours)
  - Per-course minutes-per-page overrides

## Reminders
- Enable in `/settings`. The in-app `ReminderManager` checks every 5 minutes for tasks due within the configured lead window and surfaces dismissible cards.

## License
MIT
