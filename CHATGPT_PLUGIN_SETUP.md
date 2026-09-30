# ChatGPT Plugin / MCP Setup — Law School Tracker

## Status

The Law School Tracker now exposes an authenticated Model Context Protocol endpoint for ChatGPT and other MCP clients.

- MCP URL: `https://law-school-tracker.vercel.app/api/mcp`
- Authentication: Bearer token
- Token: the existing `LAW_SCHOOL_GPT_TOKEN` value stored in Vercel
- Access: private
- Current MCP surface: read-only
- Legacy custom-GPT Action: preserved at `/api/gpt/openapi`

The MCP server is a thin compatibility layer over the existing `/api/gpt/*` routes. It does not create a second data pipeline.

## Available MCP tools

| Tool | Purpose |
| --- | --- |
| `get_workspace_overview` | Current courses, workload, readings, recent notes, and study totals |
| `list_courses` | Course and semester metadata |
| `list_assignments` | Deadlines, workflow state, reading progress, linked-note counts |
| `list_study_sessions` | Study history, time, focus, pages, and practice questions |
| `list_notebooks` | Notebook and nested section hierarchy |
| `search_notes` | Hybrid semantic/keyword note search with course and section filters |
| `get_notes` | Retrieve up to eight full notes after search |
| `get_note` | Retrieve one full note |

The old GPT Action still contains narrow write operations. Those are intentionally not exposed through MCP yet. The normal-chat integration should first be reliable and safe for retrieval before any write permissions are added.

## Recommended assistant workflow

1. For planning questions, call `get_workspace_overview`.
2. For questions scoped to a named notebook branch, call `list_notebooks` and use exact section ids.
3. For doctrinal questions, outlines, quizzes, or synthesis, call `search_notes`.
4. Retrieve the strongest matching full pages with `get_notes` or `get_note` before producing a substantive answer.
5. Treat stored notes, case briefs, and professor materials as the primary workspace source. Do not invent missing material.

## Verification

Public, non-sensitive health metadata is available with:

```text
GET https://law-school-tracker.vercel.app/api/mcp
```

All MCP POST requests require:

```text
Authorization: Bearer <LAW_SCHOOL_GPT_TOKEN>
Content-Type: application/json
```

Example initialize request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

Example tool discovery request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Example note search:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_notes",
    "arguments": {
      "course": "Evidence",
      "q": "Rule 404 other acts propensity",
      "limit": 12
    }
  }
}
```

## ChatGPT-side connection

The backend migration and the ChatGPT installation are separate steps. The server can be deployed without changing the existing site UI or legacy GPT Action.

Do not make the MCP endpoint unauthenticated. Unlike the East v. West league data, this server exposes private academic notes and study records.

The production connector/plugin should use the private MCP endpoint above and an authentication method supported by the ChatGPT plugin installation flow. Never commit the token to this repository or a plugin manifest.
