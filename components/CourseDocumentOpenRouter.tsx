"use client";

import { useEffect } from 'react';
import type { CourseDocument } from '@/lib/types';

/**
 * CourseDocument links were historically written directly to Vercel Blob.
 * Those URLs may be served with attachment disposition, so clicking "Open"
 * immediately downloads the file. Keep the existing course component stable,
 * but rewrite those document links to the first-party viewer route once the
 * course's document list is known. A MutationObserver covers the Documents tab
 * being mounted after this layout component has already loaded.
 */
export default function CourseDocumentOpenRouter({ courseId }: { courseId: string }) {
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;

    void (async () => {
      try {
        const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/documents`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const data = await response.json().catch(() => ({ documents: [] }));
        const docs = Array.isArray(data.documents) ? data.documents as CourseDocument[] : [];
        const routes = new Map<string, string>();
        for (const doc of docs) {
          try {
            const absolute = new URL(doc.url, window.location.origin).href;
            routes.set(absolute, `/courses/${encodeURIComponent(courseId)}/documents/${encodeURIComponent(doc.id)}`);
          } catch {}
        }

        const rewriteLinks = () => {
          document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
            let absolute = '';
            try { absolute = new URL(anchor.href, window.location.origin).href; } catch { return; }
            const internal = routes.get(absolute);
            if (!internal) return;
            anchor.href = internal;
            // "Open" should stay inside the tracker. Users can still open the
            // first-party viewer in another tab through normal browser actions.
            anchor.removeAttribute('target');
            anchor.removeAttribute('rel');
          });
        };

        rewriteLinks();
        observer = new MutationObserver(rewriteLinks);
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {
        // The normal document list remains usable even if this enhancement
        // cannot initialize; there is no reason to break the course page.
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [courseId]);

  return null;
}
