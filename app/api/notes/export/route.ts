import { NextRequest } from 'next/server';
import { getAiNote, listAiNotes, listNotebooks, listSections } from '@/lib/aiNotes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Take your notes with you.
 *
 * Everything lives in one Postgres database, and until now the only way out
 * was one page at a time. This returns a whole notebook - or the lot - as a
 * single Markdown document, ordered the way the tree shows it.
 */
function heading(level: number, text: string): string {
  return `${'#'.repeat(Math.min(6, level))} ${text}\n\n`;
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'law-school-notes';
}

export async function GET(req: NextRequest) {
  try {
    const wanted = req.nextUrl.searchParams.get('notebookId')?.trim() || '';
    const notebooks = (await listNotebooks()).filter(n => !wanted || n.id === wanted);
    if (!notebooks.length) {
      return new Response('No notebooks to export.', { status: 404 });
    }

    const parts: string[] = [
      `# Law School Tracker notes\n\nExported ${new Date().toISOString().slice(0, 10)}\n\n---\n\n`,
    ];

    for (const notebook of notebooks) {
      parts.push(heading(2, `${notebook.name}${notebook.semester ? ` — ${notebook.semester}` : ''}`));
      const sections = await listSections(notebook.id);
      const pages = await listAiNotes({ notebookId: notebook.id, limit: 500 });

      // Walk the section tree so the export reads in the same order as the app.
      const walk = async (parentId: string | null, depth: number): Promise<void> => {
        for (const section of sections.filter(x => (x.parentId || null) === parentId)) {
          parts.push(heading(3 + depth, section.name));
          const own = pages
            .filter(p => p.sectionId === section.id)
            .sort((a, b) => a.position - b.position);
          for (const summary of own) {
            const full = await getAiNote(summary.id);
            if (!full) continue;
            parts.push(heading(4 + depth, full.title));
            const meta = [
              full.classDate ? `Class date: ${full.classDate}` : '',
              full.sourceType ? `Type: ${full.sourceType}` : '',
              full.topics.length ? `Tags: ${full.topics.join(', ')}` : '',
            ].filter(Boolean).join(' · ');
            if (meta) parts.push(`*${meta}*\n\n`);
            parts.push(`${full.content}\n\n`);
          }
          await walk(section.id, depth + 1);
        }
      };
      await walk(null, 0);

      const unfiled = pages.filter(p => !p.sectionId);
      if (unfiled.length) {
        parts.push(heading(3, 'Unfiled'));
        for (const summary of unfiled) {
          const full = await getAiNote(summary.id);
          if (full) parts.push(heading(4, full.title) + `${full.content}\n\n`);
        }
      }
    }

    const name = wanted && notebooks[0] ? safeFilename(notebooks[0].name) : 'law-school-notes';
    return new Response(parts.join(''), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}.md"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Unable to export notes.',
      { status: 500 },
    );
  }
}
