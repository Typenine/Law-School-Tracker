import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto')
      || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
  }
  return req.nextUrl.origin;
}

const sourceTypeSchema = {
  type: 'string',
  enum: ['class-notes', 'reading-notes', 'case-brief', 'outline', 'professor-material', 'other'],
};

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const schema = {
    openapi: '3.1.0',
    info: {
      title: 'Law School Tracker Study Connector',
      version: '2.0.0',
      description: [
        'A study-oriented connector to the user’s law-school workspace. It can read courses, assignments, study history, notebooks, class notes, reading notes, case briefs, outlines, and professor materials.',
        'The real hierarchy is semester metadata > course/notebook > nested sections > pages. A notebook is normally a course such as Evidence; sections beneath it may be Class Notes, Case Briefs, Week 3, or any other structure the user creates.',
        'For study planning, begin with getWorkspaceOverview, then inspect upcoming assignments and relevant notes. For a question about a named branch, use listNotebooks to get the exact section id and searchNotes with includeDescendants=true. Search is hybrid semantic + keyword when embeddings are configured, with automatic lexical fallback.',
        'For quizzes, practice questions, outlines, or synthesis, search broadly enough to find the relevant pages, then call getNotes for the best few full notes before answering. Treat the user’s notes and case briefs as the primary source. Identify the note titles and location paths behind substantive claims, and say plainly when the workspace does not contain the answer.',
        'Write operations are deliberately narrow. Never create, append to, or relink a note unless the user explicitly asks to save or change something in the tracker. There is no GPT delete action.',
      ].join(' '),
    },
    servers: [{ url: origin }],
    security: [{ BearerAuth: [] }],
    paths: {
      '/api/gpt/overview': {
        get: {
          operationId: 'getWorkspaceOverview',
          summary: 'Get the current study-planning picture',
          description: 'Best first call for study plans and “what should I work on?” questions. Returns courses, upcoming and overdue work, notebooks, recent notes, and seven-day study totals.',
          parameters: [
            { name: 'days', in: 'query', description: 'Upcoming-assignment horizon in days.', schema: { type: 'integer', minimum: 1, maximum: 60, default: 14 } },
            { name: 'recentNotes', in: 'query', description: 'How many recently updated notes to include.', schema: { type: 'integer', minimum: 1, maximum: 20, default: 8 } },
          ],
          responses: {
            '200': { description: 'Workspace overview', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkspaceOverview' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/courses': {
        get: {
          operationId: 'listCourses',
          summary: 'List law-school courses',
          description: 'Returns course and term metadata.',
          responses: {
            '200': { description: 'Course list', content: { 'application/json': { schema: { $ref: '#/components/schemas/CourseListResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/assignments': {
        get: {
          operationId: 'listAssignments',
          summary: 'List and filter assignments',
          description: 'Use for deadlines, workload planning, and readings. noteCount tells you whether the user has pages linked to that assignment; pass its id as taskId to searchNotes.',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'done', 'all'], default: 'all' } },
            { name: 'course', in: 'query', description: 'Case-insensitive partial course-title match.', schema: { type: 'string' } },
            { name: 'from', in: 'query', description: 'Inclusive ISO date or datetime.', schema: { type: 'string' } },
            { name: 'to', in: 'query', description: 'Inclusive ISO date or datetime.', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          ],
          responses: {
            '200': { description: 'Assignment list', content: { 'application/json': { schema: { $ref: '#/components/schemas/AssignmentListResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/sessions': {
        get: {
          operationId: 'listStudySessions',
          summary: 'List logged study sessions',
          description: 'Use for effort, pace, consistency, pages read, practice questions, and focus. Totals cover everything matching the filters, not merely the returned page.',
          parameters: [
            { name: 'course', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string' } },
            { name: 'to', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          ],
          responses: {
            '200': { description: 'Sessions and totals', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionListResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/notebooks': {
        get: {
          operationId: 'listNotebooks',
          summary: 'List course notebooks and their section hierarchy',
          description: 'Returns each notebook/course and all nested sections. Use section ids rather than guessing when the user names a branch such as Evidence > Case Briefs > Week 3.',
          responses: {
            '200': { description: 'Notebook hierarchy', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotebookListResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/notes': {
        get: {
          operationId: 'searchNotes',
          summary: 'Search notes, case briefs, outlines, and course materials',
          description: 'Hybrid semantic and keyword retrieval when OPENAI_API_KEY is configured; otherwise lexical search continues to work. A sectionId searches that section plus all descendants by default. Results include locationPath, relevance diagnostics, excerpts, and note ids. Fetch the best full notes with getNotes before substantial synthesis or quiz generation.',
          parameters: [
            { name: 'q', in: 'query', description: 'Natural-language question, doctrine, case, rule, issue, or keywords.', schema: { type: 'string' } },
            { name: 'course', in: 'query', description: 'Case-insensitive partial course-title match.', schema: { type: 'string' } },
            { name: 'semester', in: 'query', schema: { type: 'string' } },
            { name: 'notebookId', in: 'query', description: 'Exact notebook id from listNotebooks.', schema: { type: 'string' } },
            { name: 'section', in: 'query', description: 'Exact section name. Prefer sectionId when names repeat.', schema: { type: 'string' } },
            { name: 'sectionId', in: 'query', description: 'Exact branch root from listNotebooks.', schema: { type: 'string' } },
            { name: 'includeDescendants', in: 'query', description: 'When sectionId is supplied, include all nested sections. Defaults to true.', schema: { type: 'boolean', default: true } },
            { name: 'taskId', in: 'query', description: 'Only pages linked to one assignment id from listAssignments.', schema: { type: 'string' } },
            { name: 'sourceType', in: 'query', description: 'Restrict to a kind of page.', schema: sourceTypeSchema },
            { name: 'topic', in: 'query', description: 'Case-insensitive exact topic/tag match.', schema: { type: 'string' } },
            { name: 'pinnedOnly', in: 'query', schema: { type: 'boolean', default: false } },
            { name: 'from', in: 'query', description: 'Earliest class date.', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', description: 'Latest class date.', schema: { type: 'string', format: 'date' } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['relevance', 'recent', 'oldest', 'class-date'], default: 'relevance' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 12 } },
          ],
          responses: {
            '200': { description: 'Ranked note matches', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteSearchResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '503': { $ref: '#/components/responses/NotConfigured' },
          },
        },
      },
      '/api/gpt/notes/batch': {
        get: {
          operationId: 'getNotes',
          summary: 'Get several full notes in one call',
          description: 'Use after searchNotes when synthesizing a doctrine, building a quiz, comparing cases, or making a study guide. Up to eight active notes are returned with full text and location paths.',
          parameters: [
            { name: 'ids', in: 'query', required: true, description: 'Comma-separated note ids from searchNotes, maximum eight.', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Full notes', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotesBatchResponse' } } } },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/gpt/notes/{id}': {
        get: {
          operationId: 'getNote',
          summary: 'Get one full note',
          description: 'Retrieve the complete text and metadata of an active note identified by searchNotes.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Full note', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/gpt/notes/create': {
        post: {
          operationId: 'createStudyNote',
          summary: 'Save a new page to an existing notebook',
          description: 'Consequential write. Call only after the user explicitly asks to save generated study material or create a note. Requires an existing notebook and never creates or deletes notebooks.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateNoteRequest' } } },
          },
          responses: {
            '201': { description: 'Created note', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } } },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/gpt/notes/{id}/append': {
        post: {
          operationId: 'appendToNote',
          summary: 'Append study material to an existing page',
          description: 'Consequential write. Call only after the user explicitly asks to add material to a specific note. Existing content is preserved and the operation refuses archived or trashed pages.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AppendNoteRequest' } } },
          },
          responses: {
            '200': { description: 'Updated note', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } } },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { $ref: '#/components/responses/Conflict' },
          },
        },
      },
      '/api/gpt/notes/{id}/link-assignment': {
        post: {
          operationId: 'linkNoteToAssignment',
          summary: 'Link or unlink a page and a reading assignment',
          description: 'Consequential write. Call only after the user explicitly asks to change the assignment relationship. taskId=null unlinks the page.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LinkAssignmentRequest' } } },
          },
          responses: {
            '200': { description: 'Updated note', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { $ref: '#/components/responses/Conflict' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API token' },
      },
      responses: {
        BadRequest: { description: 'The request is invalid.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Unauthorized: { description: 'The bearer token is missing or invalid.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        NotFound: { description: 'The requested record was not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Conflict: { description: 'The note changed before the write completed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        NotConfigured: { description: 'The connector token or backing service is not configured.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      },
      schemas: {
        ErrorResponse: {
          type: 'object', required: ['error'], properties: { error: { type: 'string' } },
        },
        Course: {
          type: 'object', required: ['id', 'title'], properties: {
            id: { type: 'string' }, code: { type: ['string', 'null'] }, title: { type: 'string' },
            instructor: { type: ['string', 'null'] }, semester: { type: ['string', 'null'] }, year: { type: ['integer', 'null'] },
            startDate: { type: ['string', 'null'] }, endDate: { type: ['string', 'null'] }, defaultActivity: { type: ['string', 'null'] },
          },
        },
        CourseListResponse: {
          type: 'object', required: ['courses'], properties: { courses: { type: 'array', items: { $ref: '#/components/schemas/Course' } } },
        },
        Assignment: {
          type: 'object', required: ['id', 'title', 'dueDate', 'status', 'tags'], properties: {
            id: { type: 'string' }, title: { type: 'string' }, course: { type: ['string', 'null'] }, dueDate: { type: 'string' },
            status: { type: 'string', enum: ['todo', 'done'] }, estimatedMinutes: { type: ['integer', 'null'] }, priority: { type: ['integer', 'null'] },
            notes: { type: ['string', 'null'] }, tags: { type: 'array', items: { type: 'string' } }, activity: { type: ['string', 'null'] },
            pagesRead: { type: ['integer', 'null'] }, term: { type: ['string', 'null'] }, noteCount: { type: 'integer' },
          },
        },
        AssignmentListResponse: {
          type: 'object', required: ['assignments', 'count'], properties: {
            assignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } }, count: { type: 'integer' },
          },
        },
        Session: {
          type: 'object', required: ['id', 'when', 'minutes'], properties: {
            id: { type: 'string' }, when: { type: 'string' }, minutes: { type: 'integer' }, focus: { type: ['integer', 'null'] },
            activity: { type: ['string', 'null'] }, pagesRead: { type: ['integer', 'null'] }, outlinePages: { type: ['integer', 'null'] },
            practiceQs: { type: ['integer', 'null'] }, notes: { type: ['string', 'null'] }, taskId: { type: ['string', 'null'] },
            taskTitle: { type: ['string', 'null'] }, course: { type: ['string', 'null'] },
          },
        },
        SessionListResponse: {
          type: 'object', required: ['sessions', 'count', 'totalMinutes'], properties: {
            sessions: { type: 'array', items: { $ref: '#/components/schemas/Session' } }, count: { type: 'integer' },
            totalMinutes: { type: 'integer' }, totalHours: { type: 'number' }, averageFocus: { type: ['number', 'null'] },
          },
        },
        NotebookSection: {
          type: 'object', required: ['id', 'name', 'pageCount', 'sections'], properties: {
            id: { type: 'string' }, name: { type: 'string' }, pageCount: { type: 'integer' },
            sections: { type: 'array', items: { $ref: '#/components/schemas/NotebookSection' } },
          },
        },
        Notebook: {
          type: 'object', required: ['id', 'name', 'sections'], properties: {
            id: { type: 'string' }, name: { type: 'string' }, course: { type: ['string', 'null'] }, semester: { type: ['string', 'null'] },
            archived: { type: 'boolean' }, pageCount: { type: 'integer' }, sections: { type: 'array', items: { $ref: '#/components/schemas/NotebookSection' } },
          },
        },
        NotebookListResponse: {
          type: 'object', required: ['notebooks'], properties: { notebooks: { type: 'array', items: { $ref: '#/components/schemas/Notebook' } } },
        },
        NoteSummary: {
          type: 'object', required: ['id', 'title', 'sourceType', 'topics', 'wordCount', 'createdAt', 'updatedAt'], properties: {
            id: { type: 'string' }, title: { type: 'string' }, notebookId: { type: ['string', 'null'] }, notebookName: { type: ['string', 'null'] },
            course: { type: ['string', 'null'] }, semester: { type: ['string', 'null'] }, section: { type: ['string', 'null'] }, sectionId: { type: ['string', 'null'] },
            locationPath: { type: 'string', description: 'Human-readable notebook and nested section path.' }, taskId: { type: ['string', 'null'] },
            classDate: { type: ['string', 'null'], format: 'date' }, sourceType: sourceTypeSchema, topics: { type: 'array', items: { type: 'string' } },
            originalFilename: { type: ['string', 'null'] }, mimeType: { type: ['string', 'null'] }, pinned: { type: 'boolean' }, archived: { type: 'boolean' },
            wordCount: { type: 'integer' }, preview: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' },
          },
        },
        NoteSearchResult: {
          allOf: [
            { $ref: '#/components/schemas/NoteSummary' },
            { type: 'object', required: ['excerpt', 'score', 'lexicalScore', 'retrievalMode', 'locationPath'], properties: {
              excerpt: { type: 'string' }, score: { type: 'number' }, lexicalScore: { type: 'number' },
              semanticScore: { type: ['number', 'null'] }, retrievalMode: { type: 'string', enum: ['hybrid', 'lexical'] }, locationPath: { type: 'string' },
            } },
          ],
        },
        NoteSearchResponse: {
          type: 'object', required: ['query', 'matches', 'count', 'retrievalMode', 'searchedSectionIds'], properties: {
            query: { type: 'string' }, matches: { type: 'array', items: { $ref: '#/components/schemas/NoteSearchResult' } }, count: { type: 'integer' },
            retrievalMode: { type: 'string', enum: ['hybrid', 'lexical'] }, searchedSectionIds: { type: 'array', items: { type: 'string' } },
          },
        },
        Note: {
          allOf: [
            { $ref: '#/components/schemas/NoteSummary' },
            { type: 'object', required: ['content'], properties: {
              content: { type: 'string', description: 'Full page as plain text.' }, images: { type: 'array', items: { type: 'string' } }, locationPath: { type: 'string' },
            } },
          ],
        },
        NoteResponse: {
          type: 'object', required: ['note'], properties: { note: { $ref: '#/components/schemas/Note' } },
        },
        NotesBatchResponse: {
          type: 'object', required: ['notes', 'count', 'requestedCount'], properties: {
            notes: { type: 'array', items: { $ref: '#/components/schemas/Note' } }, count: { type: 'integer' }, requestedCount: { type: 'integer' },
          },
        },
        CreateNoteRequest: {
          type: 'object', required: ['title', 'notebookId', 'content'], properties: {
            title: { type: 'string', maxLength: 240 }, notebookId: { type: 'string' }, sectionId: { type: ['string', 'null'] },
            content: { type: 'string' }, sourceType: sourceTypeSchema, topics: { type: 'array', maxItems: 30, items: { type: 'string' } },
            taskId: { type: ['string', 'null'] }, classDate: { type: ['string', 'null'], format: 'date' },
          },
        },
        AppendNoteRequest: {
          type: 'object', required: ['content'], properties: { heading: { type: 'string', maxLength: 240 }, content: { type: 'string' } },
        },
        LinkAssignmentRequest: {
          type: 'object', required: ['taskId'], properties: { taskId: { type: ['string', 'null'] } },
        },
        StudyByCourse: {
          type: 'object', required: ['course', 'minutes', 'sessions', 'practiceQs', 'pagesRead'], properties: {
            course: { type: 'string' }, minutes: { type: 'integer' }, sessions: { type: 'integer' }, practiceQs: { type: 'integer' }, pagesRead: { type: 'integer' },
          },
        },
        WorkspaceOverview: {
          type: 'object', required: ['generatedAt', 'planningHorizonDays', 'courses', 'upcomingAssignments', 'overdueAssignments', 'notebooks', 'recentNotes', 'studyLast7Days'], properties: {
            generatedAt: { type: 'string' }, planningHorizonDays: { type: 'integer' }, semesters: { type: 'array', items: { type: 'string' } },
            courses: { type: 'array', items: { $ref: '#/components/schemas/Course' } },
            upcomingAssignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },
            overdueAssignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },
            notebooks: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' }, name: { type: 'string' }, course: { type: ['string', 'null'] }, semester: { type: ['string', 'null'] }, pageCount: { type: 'integer' },
            } } },
            recentNotes: { type: 'array', items: { $ref: '#/components/schemas/NoteSummary' } },
            studyLast7Days: { type: 'object', properties: {
              totalMinutes: { type: 'integer' }, totalHours: { type: 'number' }, sessionCount: { type: 'integer' }, averageFocus: { type: ['number', 'null'] },
              byCourse: { type: 'array', items: { $ref: '#/components/schemas/StudyByCourse' } },
            } },
          },
        },
      },
    },
  };

  const response = Response.json(schema);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
