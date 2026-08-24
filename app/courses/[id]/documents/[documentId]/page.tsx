import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ensureSchema, getCourseDocument, listCourses } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type ViewerKind = 'pdf' | 'image' | 'text' | 'office' | 'unknown';

function ext(filename: string): string {
  return (filename.split('.').pop() || '').toLowerCase();
}

function viewerKind(filename: string, mimeType: string): ViewerKind {
  const extension = ext(filename);
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) return 'image';
  if (mimeType.startsWith('text/') || ['txt', 'md'].includes(extension)) return 'text';
  if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension)) return 'office';
  return 'unknown';
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function CourseDocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  await ensureSchema();
  const { id, documentId } = await params;
  const doc = await getCourseDocument(documentId);
  if (!doc || doc.courseId !== id) notFound();

  const courses = await listCourses();
  const course = courses.find(item => item.id === id) || null;
  const kind = viewerKind(doc.filename, doc.mimeType || '');
  const contentUrl = `/api/courses/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/content`;
  const downloadUrl = `${contentUrl}?download=1`;
  const officeUrl = /^https?:\/\//i.test(doc.url)
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`
    : null;

  return (
    <main className="space-y-4">
      <section className="card p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link href={`/courses/${encodeURIComponent(id)}#documents`} className="text-xs text-slate-400 hover:underline">
            &larr; {course?.title || 'Course'} documents
          </Link>
          <h1 className="text-xl font-semibold mt-2 break-words">{doc.title}</h1>
          <div className="text-xs text-slate-500 mt-1">
            {doc.filename} · {fmtBytes(doc.size)} · uploaded {new Date(doc.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <a href={downloadUrl} className="px-3 py-2 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">
            Download
          </a>
          <Link href={`/courses/${encodeURIComponent(id)}#documents`} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">
            Back to documents
          </Link>
        </div>
      </section>

      {kind === 'pdf' && (
        <section className="card overflow-hidden bg-white">
          <iframe src={contentUrl} title={doc.title} className="w-full h-[82vh] min-h-[640px]" />
        </section>
      )}

      {kind === 'image' && (
        <section className="card p-4 flex justify-center bg-[#07101d]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={contentUrl} alt={doc.title} className="max-w-full max-h-[82vh] object-contain rounded" />
        </section>
      )}

      {kind === 'text' && (
        <section className="card overflow-hidden bg-white">
          <iframe src={contentUrl} title={doc.title} className="w-full h-[82vh] min-h-[640px]" />
        </section>
      )}

      {kind === 'office' && officeUrl && (
        <section className="card overflow-hidden bg-white">
          <iframe
            src={officeUrl}
            title={doc.title}
            className="w-full h-[82vh] min-h-[640px]"
            referrerPolicy="no-referrer"
          />
        </section>
      )}

      {kind === 'office' && !officeUrl && (
        <section className="card p-8 text-center">
          <div className="font-medium">This Office file cannot be previewed from local storage.</div>
          <div className="text-sm text-slate-500 mt-2">The production site can display uploaded Word, PowerPoint, and Excel files in the embedded viewer.</div>
          <a href={downloadUrl} className="inline-flex mt-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Download file</a>
        </section>
      )}

      {kind === 'unknown' && (
        <section className="card p-8 text-center">
          <div className="font-medium">Preview is not available for this file type.</div>
          <div className="text-sm text-slate-500 mt-2">You can still download the original file.</div>
          <a href={downloadUrl} className="inline-flex mt-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Download file</a>
        </section>
      )}
    </main>
  );
}
