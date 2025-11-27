import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import ReminderManager from '@/components/ReminderManager'
import PWARegister from '@/components/PWARegister'
import CommandPalette from '@/components/CommandPalette'
import ThemeToggleButton from '@/components/ThemeToggleButton'

export const metadata: Metadata = {
  title: 'Law School Tracker',
  description: 'Structure your workload, stay on pace, and review your progress.',
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
        <div className="app-container">
          <header className="mb-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold">Law School Tracker</h1>
                <p className="text-sm opacity-80">Structure your workload, stay on pace, and review your progress.</p>
              </div>
              <ThemeToggleButton />
            </div>
            <nav className="flex flex-wrap gap-2 text-sm">
              <Link href="/" className="nav-link">Today</Link>
              <Link href="/week-plan" className="nav-link">Week Plan</Link>
              <Link href="/tasks" className="nav-link">Tasks</Link>
              <Link href="/courses" className="nav-link">Courses</Link>
              <Link href="/calendar" className="nav-link">Calendar</Link>
              <Link href="/settings" className="nav-link">Settings</Link>
              <Link href="/help" className="nav-link">Help</Link>
              <Link href="/review" className="nav-link">Review</Link>
              <Link href="/log" className="nav-link">Log</Link>
            </nav>
          </header>
          {children}
        </div>
        <ReminderManager />
        <PWARegister />
        <CommandPalette />
      </body>
    </html>
  )
}
