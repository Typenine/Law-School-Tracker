import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const schema = {
    openapi: '3.1.0',
    info: {
      title: 'Law School Tracker',
      version: '1.0.0',
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
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/gpt/assignments': {
        get: {
          operationId: 'listAssignments',
          summary: 'List and filter assignments',
          description: 'Use this for deadlines, workload planning, and upcoming tasks.',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'done', 'all'] } },
            { name: 'course', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', description: 'Inclusive ISO date or datetime', schema: { type: 'string' } },
            { name: 'to', in: 'query', description: 'Inclusive ISO date or datetime', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          ],
          responses: {
            '200': {
              description: 'Assignment list',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/gpt/notes': {
        get: {
          operationId: 'searchNotes',
          summary: 'Search uploaded notes',
          description: 'Search note titles and extracted text. First search for relevant notes, then call getNote for the full text of the most relevant results. When answering, cite the note title, course, and class date. If the notes do not contain an answer, say so rather than filling the gap silently.',
          parameters: [
            { name: 'q', in: 'query', description: 'Keywords, doctrine, case, rule, or topic to search', schema: { type: 'string' } },
            { name: 'course', in: 'query', schema: { type: 'string' } },
            { name: 'semester', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', description: 'Earliest class date, YYYY-MM-DD', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', description: 'Latest class date, YYYY-MM-DD', schema: { type: 'string', format: 'date' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 30, default: 12 } },
          ],
          responses: {
            '200': {
              description: 'Search results with excerpts and note IDs',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/gpt/notes/{id}': {
        get: {
          operationId: 'getNote',
          summary: 'Get the full text of one note',
          description: 'Retrieve a note after searchNotes identifies it as relevant.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Full note and metadata',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '404': { description: 'Note not found' },
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
    },
  };

  const response = Response.json(schema);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
