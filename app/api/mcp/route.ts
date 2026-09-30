import { NextRequest, NextResponse } from 'next/server';
import { requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ToolInput = Record<string, unknown>;

type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

const READ_ONLY = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const SOURCE_TYPES = ['class-notes', 'reading-notes', 'case-brief', 'outline', 'professor-material', 'other'];

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'get_workspace_overview',
    description: 'Get the current law-school study picture: courses, upcoming and overdue work, open readings, notebooks, recent notes, and seven-day study totals. Use this first for planning questions.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 60, default: 14, description: 'Upcoming-assignment horizon in days.' },
        recentNotes: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: 'Number of recently updated notes to include.' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY('Get workspace overview'),
  },
  {
    name: 'list_courses',
    description: 'List the law-school courses and term metadata stored in the tracker.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY('List courses'),
  },
  {
    name: 'list_assignments',
    description: 'List and filter assignments, including deadlines, workflow state, reading progress, and linked-note counts.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['todo', 'done', 'all'], default: 'all' },
        course: { type: 'string', description: 'Case-insensitive partial course-title match.' },
        activity: { type: 'string', description: 'Activity such as reading, review, outline, or practice.' },
        from: { type: 'string', description: 'Inclusive ISO date or datetime.' },
        to: { type: 'string', description: 'Inclusive ISO date or datetime.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY('List assignments'),
  },
  {
    name: 'list_study_sessions',
    description: 'List logged study sessions and totals for effort, pace, focus, pages read, and practice questions.',
    inputSchema: {
      type: 'object',
      properties: {
        course: { type: 'string' },
        from: { type: 'string', description: 'Inclusive ISO date or datetime.' },
        to: { type: 'string', description: 'Inclusive ISO date or datetime.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY('List study sessions'),
  },
  {
    name: 'list_notebooks',
    description: 'List course notebooks and the complete nested section hierarchy. Use the returned section ids instead of guessing when a user names a branch.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY('List notebooks'),
  },
  {
    name: 'search_notes',
    description: 'Search class notes, reading notes, case briefs, outlines, and professor materials. Search is hybrid semantic plus keyword when embeddings are configured, with lexical fallback. Fetch the best full notes before substantial synthesis.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Natural-language question, doctrine, case, rule, issue, or keywords.' },
        course: { type: 'string', description: 'Case-insensitive partial course-title match.' },
        semester: { type: 'string' },
        notebookId: { type: 'string', description: 'Exact notebook id from list_notebooks.' },
        section: { type: 'string', description: 'Exact section name. Prefer sectionId when names repeat.' },
        sectionId: { type: 'string', description: 'Exact branch root from list_notebooks.' },
        includeDescendants: { type: 'boolean', default: true, description: 'When sectionId is supplied, include nested sections.' },
        taskId: { type: 'string', description: 'Only pages linked to one assignment id from list_assignments.' },
        sourceType: { type: 'string', enum: SOURCE_TYPES },
        topic: { type: 'string', description: 'Case-insensitive exact topic/tag match.' },
        pinnedOnly: { type: 'boolean', default: false },
        from: { type: 'string', format: 'date', description: 'Earliest class date.' },
        to: { type: 'string', format: 'date', description: 'Latest class date.' },
        sort: { type: 'string', enum: ['relevance', 'recent', 'oldest', 'class-date'], default: 'relevance' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 12 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY('Search notes'),
  },
  {
    name: 'get_notes',
    description: 'Get up to eight full notes in one call after search_notes. Use for outlines, doctrine synthesis, case comparison, quizzes, and study guides.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 8,
          description: 'Note ids returned by search_notes.',
        },
      },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: READ_ONLY('Get full notes'),
  },
  {
    name: 'get_note',
    description: 'Retrieve the complete text and metadata for one active note returned by search_notes.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Exact note id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: READ_ONLY('Get one note'),
  },
];

const identity = {
  name: 'law-school-tracker-mcp',
  version: '1.0.0',
  description: 'Authenticated read-only access to the Law School Tracker workspace, including courses, assignments, study history, notebooks, class notes, reading notes, case briefs, outlines, and professor materials.',
};

class ToolCallError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function ok(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { status: 200 });
}

function err(id: string | number | null, code: number, message: string, data?: unknown) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { status: 200 },
  );
}

function queryString(input: ToolInput, keys: string[]): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.map(item => String(item)).join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const value = params.toString();
  return value ? `?${value}` : '';
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Tracker request failed with status ${response.status}.`;
    throw new ToolCallError(response.status, message);
  }
  return body;
}

async function gptGet(request: NextRequest, path: string): Promise<unknown> {
  const authorization = request.headers.get('authorization') || '';
  const response = await fetch(new URL(path, request.url), {
    method: 'GET',
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  return readJsonResponse(response);
}

function requiredString(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolCallError(400, `Missing required parameter: ${key}`);
  }
  return value.trim();
}

async function dispatchTool(request: NextRequest, name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    case 'get_workspace_overview':
      return gptGet(request, `/api/gpt/overview${queryString(input, ['days', 'recentNotes'])}`);
    case 'list_courses':
      return gptGet(request, '/api/gpt/courses');
    case 'list_assignments':
      return gptGet(request, `/api/gpt/assignments${queryString(input, ['status', 'course', 'activity', 'from', 'to', 'limit'])}`);
    case 'list_study_sessions':
      return gptGet(request, `/api/gpt/sessions${queryString(input, ['course', 'from', 'to', 'limit'])}`);
    case 'list_notebooks':
      return gptGet(request, '/api/gpt/notebooks');
    case 'search_notes':
      return gptGet(
        request,
        `/api/gpt/notes${queryString(input, [
          'q', 'course', 'semester', 'notebookId', 'section', 'sectionId', 'includeDescendants',
          'taskId', 'sourceType', 'topic', 'pinnedOnly', 'from', 'to', 'sort', 'limit',
        ])}`,
      );
    case 'get_notes': {
      const ids = Array.isArray(input.ids)
        ? input.ids.map(value => String(value).trim()).filter(Boolean).slice(0, 8)
        : [];
      if (!ids.length) throw new ToolCallError(400, 'Provide at least one note id.');
      return gptGet(request, `/api/gpt/notes/batch?ids=${encodeURIComponent(ids.join(','))}`);
    }
    case 'get_note': {
      const id = requiredString(input, 'id');
      return gptGet(request, `/api/gpt/notes/${encodeURIComponent(id)}`);
    }
    default:
      throw new ToolCallError(404, `Unknown tool: ${name}`);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireGptToken(request);
  if (denied) return denied;

  let body: { id?: string | number | null; method?: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return err(null, -32700, 'Parse error: invalid JSON');
  }

  const { id = null, method, params } = body;
  if (!method || typeof method !== 'string') {
    return err(id, -32600, 'Invalid Request: missing method');
  }

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: identity,
      instructions: [
        'Use get_workspace_overview first for planning and workload questions.',
        'Use list_notebooks to resolve exact section ids when the user names a notebook branch.',
        'For substantive study synthesis, search with search_notes and then retrieve the strongest matching full pages with get_notes or get_note before answering.',
        'Treat the user\'s stored notes and case briefs as primary workspace evidence and identify relevant note titles or location paths in the answer when useful.',
        'This MCP surface is read-only. Do not claim to have saved, changed, or deleted tracker data.',
      ].join(' '),
    });
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 });
  }

  if (method === 'ping') {
    return ok(id, {});
  }

  if (method === 'tools/list') {
    return ok(id, { tools: MCP_TOOLS });
  }

  if (method === 'tools/call') {
    const call = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof call.name !== 'string' || !call.name) {
      return err(id, -32602, 'Invalid params: missing tool name');
    }
    const input = call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
      ? call.arguments as ToolInput
      : {};

    try {
      const data = await dispatchTool(request, call.name, input);
      return ok(id, {
        structuredContent: data,
        content: [{ type: 'text', text: JSON.stringify(data) }],
        isError: false,
      });
    } catch (error) {
      if (error instanceof ToolCallError) {
        return ok(id, {
          content: [{ type: 'text', text: error.message }],
          isError: true,
          structuredContent: { error: error.message, status: error.status },
        });
      }
      console.error(`[mcp] tool=${call.name}`, error);
      return err(id, -32603, 'Internal error');
    }
  }

  return err(id, -32601, `Method not found: ${method}`);
}

export async function GET() {
  return NextResponse.json({
    ...identity,
    protocol: 'MCP HTTP Transport 2025-03-26',
    endpoint: 'POST /api/mcp',
    authScheme: 'Authorization: Bearer <LAW_SCHOOL_GPT_TOKEN>',
    access: 'private',
    readOnly: true,
    toolCount: MCP_TOOLS.length,
    tools: MCP_TOOLS.map(tool => tool.name),
  });
}
