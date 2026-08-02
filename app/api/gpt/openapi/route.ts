import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  const schema = {
    openapi: '3.0.3',
    info: {
      title: 'Law School Tracker',
      version: '1.0.1',
      description: 'Read-only access to the user’s courses, assignments, and uploaded law-school notes. Treat uploaded notes as the primary source and clearly identify the note title, course, and class date used in substantive answers.',
    },
    servers: [{ url: origin }],
    security: [{ BearerAuth: [] }],
    paths: {
      '/api/gpt/courses': {
        get: {
          operationId: 'listCourses',
          summary: 'List law-school courses',
          description: 'Returns courses and term details stored in the tracker.',
          responses: {
            '200': {
              description: 'Course list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CourseListResponse' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/assignments': {
        get: {
          operationId: 'listAssignments',
          summary: 'List and filter assignments',
          description: 'Use this for deadlines, workload planning, and upcoming tasks.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              description: 'Filter by completion status.',
              schema: { type: 'string', enum: ['todo', 'done', 'all'], default: 'all' },
            },
            {
              name: 'course',
              in: 'query',
              description: 'Case-insensitive partial course-title match.',
              schema: { type: 'string' },
            },
            {
              name: 'from',
              in: 'query',
              description: 'Inclusive ISO date or datetime.',
              schema: { type: 'string' },
            },
            {
              name: 'to',
              in: 'query',
              description: 'Inclusive ISO date or datetime.',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            '200': {
              description: 'Assignment list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AssignmentListResponse' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/notes': {
        get: {
          operationId: 'searchNotes',
          summary: 'Search uploaded notes',
          description: 'Search note titles and extracted text. First search for relevant notes, then call getNote for the full text of the most relevant results. When answering, cite the note title, course, and class date. If the notes do not contain an answer, say so rather than filling the gap silently.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              description: 'Keywords, doctrine, case, rule, or topic to search.',
              schema: { type: 'string' },
            },
            {
              name: 'course',
              in: 'query',
              description: 'Case-insensitive partial course-title match.',
              schema: { type: 'string' },
            },
            {
              name: 'semester',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'from',
              in: 'query',
              description: 'Earliest class date, YYYY-MM-DD.',
              schema: { type: 'string', format: 'date' },
            },
            {
              name: 'to',
              in: 'query',
              description: 'Latest class date, YYYY-MM-DD.',
              schema: { type: 'string', format: 'date' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 30, default: 12 },
            },
          ],
          responses: {
            '200': {
              description: 'Search results with excerpts and note IDs',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NoteSearchResponse' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/notes/{id}': {
        get: {
          operationId: 'getNote',
          summary: 'Get the full text of one note',
          description: 'Retrieve a note after searchNotes identifies it as relevant.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'The note ID returned by searchNotes.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Full note and metadata',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NoteResponse' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API token',
        },
      },
      responses: {
        Unauthorized: {
          description: 'The bearer token is missing or invalid.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        NotFound: {
          description: 'The requested record was not found.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        NotConfigured: {
          description: 'The server-side GPT token has not been configured.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
          },
        },
        Course: {
          type: 'object',
          required: ['id', 'title'],
          properties: {
            id: { type: 'string' },
            code: { type: 'string', nullable: true },
            title: { type: 'string' },
            instructor: { type: 'string', nullable: true },
            semester: { type: 'string', nullable: true },
            year: { type: 'integer', nullable: true },
            startDate: { type: 'string', format: 'date-time', nullable: true },
            endDate: { type: 'string', format: 'date-time', nullable: true },
            defaultActivity: { type: 'string', nullable: true },
          },
        },
        CourseListResponse: {
          type: 'object',
          required: ['courses'],
          properties: {
            courses: {
              type: 'array',
              items: { $ref: '#/components/schemas/Course' },
            },
          },
        },
        Assignment: {
          type: 'object',
          required: ['id', 'title', 'dueDate', 'status', 'tags'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            course: { type: 'string', nullable: true },
            dueDate: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['todo', 'done'] },
            estimatedMinutes: { type: 'integer', nullable: true },
            priority: { type: 'integer', nullable: true },
            notes: { type: 'string', nullable: true },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            activity: { type: 'string', nullable: true },
            pagesRead: { type: 'integer', nullable: true },
            term: { type: 'string', nullable: true },
          },
        },
        AssignmentListResponse: {
          type: 'object',
          required: ['assignments', 'count'],
          properties: {
            assignments: {
              type: 'array',
              items: { $ref: '#/components/schemas/Assignment' },
            },
            count: { type: 'integer' },
          },
        },
        NoteSummary: {
          type: 'object',
          required: [
            'id',
            'title',
            'sourceType',
            'topics',
            'wordCount',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            course: { type: 'string', nullable: true },
            semester: { type: 'string', nullable: true },
            classDate: { type: 'string', format: 'date', nullable: true },
            sourceType: {
              type: 'string',
              enum: [
                'class-notes',
                'reading-notes',
                'case-brief',
                'outline',
                'professor-material',
                'other',
              ],
            },
            topics: {
              type: 'array',
              items: { type: 'string' },
            },
            originalFilename: { type: 'string', nullable: true },
            mimeType: { type: 'string', nullable: true },
            wordCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        NoteSearchResult: {
          allOf: [
            { $ref: '#/components/schemas/NoteSummary' },
            {
              type: 'object',
              required: ['excerpt', 'score'],
              properties: {
                excerpt: { type: 'string' },
                score: { type: 'number', format: 'float' },
              },
            },
          ],
        },
        NoteSearchResponse: {
          type: 'object',
          required: ['query', 'matches', 'count'],
          properties: {
            query: { type: 'string' },
            matches: {
              type: 'array',
              items: { $ref: '#/components/schemas/NoteSearchResult' },
            },
            count: { type: 'integer' },
          },
        },
        Note: {
          allOf: [
            { $ref: '#/components/schemas/NoteSummary' },
            {
              type: 'object',
              required: ['content'],
              properties: {
                content: { type: 'string' },
              },
            },
          ],
        },
        NoteResponse: {
          type: 'object',
          required: ['note'],
          properties: {
            note: { $ref: '#/components/schemas/Note' },
          },
        },
      },
    },
  };

  const response = Response.json(schema);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
