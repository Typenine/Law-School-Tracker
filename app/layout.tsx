import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import ReminderManager from '@/components/ReminderManager'
import PWARegister from '@/components/PWARegister'
import CommandPalette from '@/components/CommandPalette'

export const metadata: Metadata = {
  title: 'Law School Tracker',
  description: 'Structure your workload, stay on pace, and review your progress.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0b1020" />
      </head>
      <body>
        <div className="app-container">
          <header className="mb-6 space-y-3">
            <div>
              <h1 className="text-2xl font-semibold">Law School Tracker</h1>
              <p className="text-sm text-slate-300/80">Structure your workload, stay on pace, and review your progress.</p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm">
              <Link href="/" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Today</Link>
              <Link href="/week-plan" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Week Plan</Link>
              <Link href="/backlog" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Backlog</Link>
              <Link href="/courses" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Courses</Link>
              <Link href="/calendar" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Calendar</Link>
              <Link href="/settings" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Settings</Link>
              <Link href="/help" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Help</Link>
              <Link href="/review" className="px-3 py-1.5 rounded border border-[#1b2344] hover:bg-[#0b1020]">Review</Link>
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
