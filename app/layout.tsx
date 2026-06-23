import './globals.css'
import type { Metadata } from 'next'
import ReminderManager from '@/components/ReminderManager'
import PWARegister from '@/components/PWARegister'
import CommandPalette from '@/components/CommandPalette'
import ThemeToggleButton from '@/components/ThemeToggleButton'
import AppNav from '@/components/AppNav'
import SetupChecklist from '@/components/SetupChecklist'
import Providers from '@/app/providers'

export const metadata: Metadata = {
  title: 'Law School Tracker',
  description: 'Know what to do next, open the material, and stay ready for class and exams.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0b1020" />
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var theme = localStorage.getItem('themePreference');
                if (theme === 'light') {
                  document.documentElement.classList.remove('dark');
                  document.documentElement.classList.add('light');
                }
              } catch (e) {}
            })();
          `
        }} />
      </head>
      <body>
        <Providers>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-emerald-500 focus:px-4 focus:py-2 focus:text-slate-950">Skip to content</a>
          <div className="app-container">
            <header className="mb-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold">Law School Tracker</h1>
                  <p className="text-sm opacity-80">Know what to do next, open the material, and stay ready for class and exams.</p>
                </div>
                <ThemeToggleButton />
              </div>
              <AppNav />
            </header>
            <SetupChecklist />
            <div id="main-content">{children}</div>
          </div>
          <ReminderManager />
          <PWARegister />
          <CommandPalette />
        </Providers>
      </body>
    </html>
  )
}
