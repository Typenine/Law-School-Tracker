"use client";

import { useEffect } from 'react';

export default function OfflineReplayRefresh() {
  useEffect(() => {
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => window.location.reload(), 250);
    };
    window.addEventListener('tracker-data-changed', refresh);
    return () => window.removeEventListener('tracker-data-changed', refresh);
  }, []);
  return null;
}
