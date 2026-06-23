import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import ReminderManager from '@/components/ReminderManager'
import PWARegister from '@/components/PWARegister'
import CommandPalette from '@/components/CommandPalette'
import ThemeToggleButton from '@/components/ThemeToggleButton'
import Providers from '@/app/providers'

export const metadata: Metadata = {
  title: 'Law School Tracker',
  description: 'Know what to do next, what is due soon, and where each course stands.',
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
          <div className="app-container">
            <header className="mb-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold">Law School Tracker</h1>
                  <p className="text-sm opacity-80">Know what to do next, what is due soon, and where each course stands.</p>
                </div>
                <ThemeToggleButton />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 pb-3">
                <nav className="flex flex-wrap gap-2 text-sm">
                  <Link href="/" className="nav-link">Today</Link>
                  <Link href="/tasks" className="nav-link">Tasks</Link>
                  <Link href="/courses" className="nav-link">Courses</Link>
                  <Link href="/calendar" className="nav-link">Calendar</Link>
                  <Link href="/review" className="nav-link">Weekly Review</Link>
                  <Link href="/settings" className="nav-link">Settings</Link>
                </nav>
                <details className="relative text-sm">
                  <summary className="cursor-pointer list-none rounded-lg border border-slate-600 px-3 py-2 text-slate-300 hover:bg-slate-800">More</summary>
                  <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-xl">
                    <Link href="/week-plan" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Week Plan</Link>
                    <Link href="/log" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Study Log</Link>
                    <Link href="/help" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Help</Link>
                  </div>
                </details>
              </div>
            </header>
            {children}
          </div>
          <ReminderManager />
          <PWARegister />
          <CommandPalette />
        </Providers>
      </body>
    </html>
  )
}
