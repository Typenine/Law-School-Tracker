"use client";

import React from 'react';
import { SettingsProvider } from '@/lib/useSettings';
import ToastProvider from '@/components/ToastProvider';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </SettingsProvider>
  );
}
