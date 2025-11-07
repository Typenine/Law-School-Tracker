"use client";
import { useEffect } from 'react';

const LEGACY_KEYS = [
  'extractTasksDefault',
  'courseMppMap',
  'wizardPreview',
];

export default function LegacyCleanup() {
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      for (const key of LEGACY_KEYS) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }, []);

  return null;
}
