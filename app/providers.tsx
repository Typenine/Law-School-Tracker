"use client";

import React from 'react';
import { SettingsProvider } from '@/lib/useSettings';
import ToastProvider from '@/components/ToastProvider';

// Notes management follows the same access model as the rest of the tracker.
// This internal marker only lets the existing notes workspace initialize; it
// is not a credential and is never used by the protected GPT endpoints.
if (typeof window !== 'undefined' && !window.localStorage.getItem('lawSchoolNotesToken')) {
  window.localStorage.setItem('lawSchoolNotesToken', 'tracker');
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </SettingsProvider>
  );
}
