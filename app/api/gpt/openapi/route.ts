import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  const schema = {
    openapi: '3.1.0',
    info: {
      title: 'Law School Tracker',
      version: '1.0.2',
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
      '/api/gpt/notebooks': {
        get: {
          operationId: 'listNotebooks',
          summary: 'List notebooks and their section hierarchy',
          description: 'Returns every notebook with its nested sections. Notes are organised as notebook (a semester, such as "Fall 2026") > subject (such as "Evidence") > category (such as "Case Briefs" or "Class Notes") > week > pages, though the depth is up to the user. Call this first when a question names a subject, a category or a week, then pass the matching sectionId to searchNotes so you search the right branch instead of guessing at names.',
          responses: {
            '200': {
              description: 'Notebooks with nested sections',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NotebookListResponse' },
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
              name: 'notebookId',
              in: 'query',
              description: 'Restrict the search to one notebook. Get the id from listNotebooks.',
              schema: { type: 'string' },
            },
            {
              name: 'section',
              in: 'query',
              description: 'The section a page sits in, such as a category ("Case Briefs") or a week ("Week 3"). Exact match on the section name. Sections nest, so the same name can appear under more than one subject - prefer sectionId when you know it.',
              schema: { type: 'string' },
            },
            {
              name: 'sectionId',
              in: 'query',
              description: 'Restrict the search to one exact section from listNotebooks. This is the precise way to ask for one branch of the hierarchy, for example the Week 3 folder under Evidence > Case Briefs.',
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
            code: { type: ['string', 'null'] },
            title: { type: 'string' },
            instructor: { type: ['string', 'null'] },
            semester: { type: ['string', 'null'] },
            year: { type: ['integer', 'null'] },
            startDate: { type: ['string', 'null'], format: 'date-time' },
            endDate: { type: ['string', 'null'], format: 'date-time' },
            defaultActivity: { type: ['string', 'null'] },
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
            course: { type: ['string', 'null'] },
            dueDate: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['todo', 'done'] },
            estimatedMinutes: { type: ['integer', 'null'] },
            priority: { type: ['integer', 'null'] },
            notes: { type: ['string', 'null'] },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            activity: { type: ['string', 'null'] },
            pagesRead: { type: ['integer', 'null'] },
            term: { type: ['string', 'null'] },
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
            course: { type: ['string', 'null'] },
            semester: { type: ['string', 'null'] },
            notebookId: { type: ['string', 'null'] },
            notebookName: { type: ['string', 'null'] },
            section: {
              type: ['string', 'null'],
              description: 'Name of the section this page is filed under.',
            },
            sectionId: {
              type: ['string', 'null'],
              description: 'Pass back to searchNotes to find the rest of this page’s section.',
            },
            classDate: { type: ['string', 'null'], format: 'date' },
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
            originalFilename: { type: ['string', 'null'] },
            mimeType: { type: ['string', 'null'] },
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
                score: { type: 'number' },
              },
            },
          ],
        },
        NotebookSection: {
          type: 'object',
          required: ['id', 'name', 'pageCount', 'sections'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            pageCount: { type: 'integer' },
            sections: {
              type: 'array',
              description: 'Sections nested directly beneath this one.',
              items: { $ref: '#/components/schemas/NotebookSection' },
            },
          },
        },
        NotebookListResponse: {
          type: 'object',
          required: ['notebooks'],
          properties: {
            notebooks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'sections'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  course: { type: ['string', 'null'] },
                  semester: { type: ['string', 'null'] },
                  archived: { type: 'boolean' },
                  pageCount: { type: 'integer' },
                  sections: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/NotebookSection' },
                  },
                },
              },
            },
          },
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
