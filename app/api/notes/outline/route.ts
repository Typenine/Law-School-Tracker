import { NextRequest } from 'next/server';
import { getAiNote, getNotebook, listAiNotes, listSections } from '@/lib/aiNotes';
import { escapeHtml } from '@/lib/notes/htmlUtils';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Compile one notebook's pages into a single running document - the "master
 * outline" students build up over a semester by tagging the pages that
 * belong in it, rather than writing it separately from scratch.
 *
 * Two shapes come out of the same walk of the section tree:
 *  - JSON (default): structured sections/pages for the in-app live view.
 *  - `?format=html`: a standalone, print-ready HTML document. The Notes UI
 *    opens this directly in a new tab so the browser's own Print / Save as
 *    PDF handles the rest, without fighting the app's own dark-theme CSS.
 */

type OutlinePage = {
  id: string;
  title: string;
  classDate: string | null;
  sourceType: string;
  topics: string[];
  contentHtml: string;
};

type OutlineSection = {
  id: string;
  name: string;
  depth: number;
  pages: OutlinePage[];
};

async function compile(notebookId: string, tag: string) {
  const notebook = await getNotebook(notebookId);
  if (!notebook) return null;

  const sections = await listSections(notebookId);
  const allPages = await listAiNotes({ notebookId, limit: 500 });
  const wanted = tag.trim().toLowerCase();
  const matches = (topics: string[]) => !wanted || topics.some(t => t.toLowerCase() === wanted);

  const outlineSections: OutlineSection[] = [];
  const unfiled: OutlinePage[] = [];

  const loadPage = async (id: string): Promise<OutlinePage | null> => {
    const full = await getAiNote(id);
    if (!full) return null;
    return {
      id: full.id,
      title: full.title,
      classDate: full.classDate,
      sourceType: full.sourceType,
      topics: full.topics,
      contentHtml: full.contentHtml,
    };
  };

  const walk = async (parentId: string | null, depth: number): Promise<void> => {
    for (const section of sections.filter(x => (x.parentId || null) === parentId)) {
      const own = allPages
        .filter(p => p.sectionId === section.id && matches(p.topics))
        .sort((a, b) => a.position - b.position);
      const pages: OutlinePage[] = [];
      for (const summary of own) {
        const page = await loadPage(summary.id);
        if (page) pages.push(page);
      }
      if (pages.length) outlineSections.push({ id: section.id, name: section.name, depth, pages });
      await walk(section.id, depth + 1);
    }
  };
  await walk(null, 0);

  for (const summary of allPages.filter(p => !p.sectionId && matches(p.topics))) {
    const page = await loadPage(summary.id);
    if (page) unfiled.push(page);
  }

  return {
    notebook: { id: notebook.id, name: notebook.name, semester: notebook.semester },
    tag: wanted || null,
    sections: outlineSections,
    unfiled,
  };
}

function renderHtmlDocument(data: NonNullable<Awaited<ReturnType<typeof compile>>>): string {
  const title = `${data.notebook.name}${data.tag ? ` — ${data.tag}` : ''} outline`;
  const pageBlock = (page: OutlinePage) => `
    <article class="outline-page">
      <h3>${escapeHtml(page.title)}</h3>
      ${page.classDate || page.topics.length
        ? `<p class="outline-meta">${[
            page.classDate ? escapeHtml(page.classDate) : '',
            page.topics.length ? escapeHtml(page.topics.join(', ')) : '',
          ].filter(Boolean).join(' · ')}</p>`
        : ''}
      <div class="outline-body">${page.contentHtml}</div>
    </article>`;
  const sectionsHtml = data.sections
    .map(section => `
      <section class="outline-section" style="margin-left:${section.depth * 18}px">
        <h2>${escapeHtml(section.name)}</h2>
        ${section.pages.map(pageBlock).join('\n')}
      </section>`)
    .join('\n');
  const unfiledHtml = data.unfiled.length
    ? `<section class="outline-section"><h2>Unfiled</h2>${data.unfiled.map(pageBlock).join('\n')}</section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 24px 80px; font: 15px/1.6 Georgia, 'Times New Roman', serif; color: #111; }
  h1 { font-size: 24px; margin-bottom: 2px; }
  .outline-subtitle { color: #555; font-size: 13px; margin: 0 0 28px; }
  h2 { font-size: 18px; margin: 26px 0 10px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .outline-page { margin: 0 0 20px; page-break-inside: avoid; }
  .outline-page h3 { font-size: 15px; margin: 0 0 2px; }
  .outline-meta { color: #666; font-size: 11px; margin: 0 0 8px; }
  .outline-body img { max-width: 100%; }
  .outline-body table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  .outline-body td, .outline-body th { border: 1px solid #999; padding: 5px 8px; font-size: 13px; }
  .outline-body th { background: #eee; }
  @media print { body { margin: 0; padding: 0 12px; } }
</style>
</head>
<body>
  <h1>${escapeHtml(data.notebook.name)}</h1>
  <p class="outline-subtitle">${[data.notebook.semester, data.tag ? `tag: ${data.tag}` : '']
    .filter((value): value is string => Boolean(value))
    .map(escapeHtml)
    .join(' · ')}</p>
  ${sectionsHtml}
  ${unfiledHtml}
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get('notebookId')?.trim();
    const tag = req.nextUrl.searchParams.get('tag') || '';
    const format = req.nextUrl.searchParams.get('format') || 'json';
    if (!notebookId) {
      return noStoreJson({ error: 'notebookId is required.' }, { status: 400 });
    }
    const data = await compile(notebookId, tag);
    if (!data) return noStoreJson({ error: 'Notebook not found.' }, { status: 404 });

    if (format === 'html') {
      return new Response(renderHtmlDocument(data), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return noStoreJson({ outline: data });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to build the outline.' },
      { status: 500 },
    );
  }
}
