# Browser storage audit (2026-10-13)

## Authoritative academic data

- Assignments, workflow state, dependencies and reading progress: PostgreSQL via task APIs.
- Notebooks, sections, note contents and revision snapshots: PostgreSQL via notes APIs.
- Study logs: PostgreSQL via sessions APIs.
- Weekly study blocks: PostgreSQL via `/api/schedule`; `weekScheduleV1` in localStorage is a read-through/offline cache. A successful server fetch must always replace it; failed writes must roll back optimistic changes.
- Availability template: PostgreSQL settings; `availabilityTemplateV1` is a fallback cache.
- Dashboard visibility and rail ordering: PostgreSQL settings `dashboardSectionsV1` and `dashboardOrderV1`.
- Availability windows/breaks and week-plan display setting: PostgreSQL settings with local fallbacks on the legacy weekly planning page.

## Browser-local state requiring further consideration

| Key / state | Role | Risk | Recommendation |
| --- | --- | --- | --- |
| `todayPlanV1`, `todayFocusV1` | Local focus and daily plan | Different plans on different devices | Migrate the plan and chosen focus to server-backed settings; retain local fallback. |
| `taskTimersV1`, task timer accumulators | Active, unfinished work timers | Device-specific and vulnerable to clearing storage | Consider server-backed checkpoint/recovery, but avoid network traffic per second. |
| `weeklyGoalsV1` | Weekly study goals on legacy plan | Goal may differ by browser | Migrate to settings when consolidating goal controls. |
| `backlogItemsV1` | Legacy backlog cache | Potentially stale or duplicated records | Prefer task API and verify legacy migration before removal. |
| `courseMppMap`, `minutesPerPage` | Local estimate overrides used by older planner | Different advice across devices | Consolidate into course prefs/settings already present elsewhere. |
| `heavyDayThreshold` | Weekly balance threshold | Different balance behavior across browsers | Promote to a named planning preference. |
| `weekPlanWeekStartYmd`, `weekPlanTwoWeeksOnly` | Week navigation and view options | Low risk | Keep view selection local, synchronize only intentional user preferences. |
| `notesLastNotebook`, `notesLastSection:*`, `notesLastPage:*`, `notesTreeOpenV1` | Editor navigation and expansion | Low risk | Local UI history is appropriate. Never treat these as note data. |
| `lstRecentPagesV1` | Sidebar recent-page shortcuts | Device-specific by design | Local UI convenience only; preserve URLs rather than full note content. |

## Risks and release guidance

1. Never allow a cache to overwrite a reachable server response.
2. Do not clear or rename old browser keys until user data is verified migrated.
3. Do not rely on localStorage for note contents, revisions, study sessions, or deadlines.
4. Avoid browser-only settings that materially alter schedule calculations or prioritization.
5. Check multi-tab updates, offline recovery, schedule rollback and timezone boundaries in Chromium before production deployment.
6. A browser-only recent-items list is not a cross-device history. If cross-device history is later needed, implement a separate server preference with appropriate retention.
7. Current note revision storage is bounded to fifty fifteen-minute recovery snapshots per note. Monitor database storage and orphan cleanup after permanent deletion.
8. The ChatGPT MCP endpoint is read-only and requires a private bearer token. The connected ChatGPT plugin currently reports incomplete server-side credential setup. Do not put the token in git, a public diagnostics response, or browser storage.

## In this branch

- Rebalancing now updates scheduled study blocks instead of academic due dates and requires confirmation.
- Adaptive suggestions use availability and existing blocks; applying them does not generate duplicate prep tasks.
- Dashboard order/visibility is saved in server settings.
- Recent-page shortcuts remain browser-local intentionally.
- Note edit history is saved in PostgreSQL, not browser storage.

This is a storage architecture audit and migration roadmap, not a claim that every historical local-only key has been migrated. Follow-up migrations must be reconciled with legacy data in actual user browsers.
