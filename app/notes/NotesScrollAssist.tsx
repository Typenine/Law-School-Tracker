'use client';

import { useEffect } from 'react';

/**
 * The note body owns the vertical scroll, but the title and formatting ribbon
 * sit above that scroll container. Forward wheel/trackpad gestures from those
 * surfaces into the canvas so the whole note column behaves like one document.
 */
export default function NotesScrollAssist() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const column = target.closest('.nb-canvas-column');
      if (!column || target.closest('.nb-canvas')) return;
      if (target.closest('select, .nb-menu, .nb-link-menu')) return;

      const canvas = column.querySelector<HTMLElement>('.nb-canvas');
      if (!canvas || canvas.scrollHeight <= canvas.clientHeight) return;
      canvas.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' });
    };

    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);

  return null;
}
