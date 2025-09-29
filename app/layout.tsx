import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import ReminderManager from '@/components/ReminderManager'

export const metadata: Metadata = {
  title: 'Law School Tracker',
  description: 'Stay on track with readings and assignments, plus study session logging.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">Law School Tracker</h1>
            <p className="text-sm text-slate-300/80">Upload syllabi, manage tasks, and log study sessions.</p>
            <nav className="mt-2 flex gap-3 text-sm">
              <Link href="/" className="px-2 py-1 rounded border border-[#1b2344] hover:bg-[#0b1020]">Home</Link>
              <Link href="/planner" className="px-2 py-1 rounded border border-[#1b2344] hover:bg-[#0b1020]">Planner</Link>
              <Link href="/settings" className="px-2 py-1 rounded border border-[#1b2344] hover:bg-[#0b1020]">Settings</Link>
            </nav>
          </header>
          {children}
        </div>
        <ReminderManager />
      </body>
    </html>
  )
}
