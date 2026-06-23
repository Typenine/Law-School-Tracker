"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const primary = [
  ['/', 'Today'],
  ['/tasks', 'Tasks'],
  ['/courses', 'Courses'],
  ['/calendar', 'Calendar'],
  ['/review', 'Weekly Review'],
  ['/exam', 'Exam Prep'],
  ['/semester', 'Term Setup'],
] as const;

export default function AppNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 pb-3">
      <nav className="flex max-w-full gap-1 overflow-x-auto text-sm">
        {primary.map(([href, label]) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-2 transition ${active ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'}`}>{label}</Link>;
        })}
      </nav>
      <details className="relative text-sm">
        <summary className="cursor-pointer list-none rounded-lg border border-slate-600 px-3 py-2 text-slate-300 hover:bg-slate-800">More</summary>
        <div className="absolute right-0 z-30 mt-2 w-52 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-xl">
          <Link href="/recovery" className="block rounded-lg px-3 py-2 text-rose-300 hover:bg-slate-800">I’m Behind</Link>
          <Link href="/questions" className="block rounded-lg px-3 py-2 text-sky-300 hover:bg-slate-800">Questions & Office Hours</Link>
          <Link href="/outline-updates" className="block rounded-lg px-3 py-2 text-violet-300 hover:bg-slate-800">Outline Updates</Link>
          <Link href="/wizard" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Import Syllabus</Link>
          <Link href="/calendar/google" className="block rounded-lg px-3 py-2 text-sky-300 hover:bg-slate-800">Google Calendar</Link>
          <Link href="/week-plan" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Plan My Week</Link>
          <Link href="/log" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Study History</Link>
          <Link href="/settings" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Settings</Link>
          <Link href="/help" className="block rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Setup Guide</Link>
        </div>
      </details>
    </div>
  );
}
