'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onPageSubtitle } from '@/lib/chromeBus';
import { onTasksChanged } from '@/lib/taskBus';
import { onCoursesChanged } from '@/lib/coursesBus';
import { onSessionsChanged } from '@/lib/sessionsBus';
import { openCommandPalette } from '@/components/CommandPalette';
import { useTerm } from '@/lib/useTerm';
import { courseInTerm } from '@/lib/semester';

/**
 * The application shell: sidebar, page heading and header actions.
 *
 * This used to be a raw <script> injected into the layout that reached into
 * the DOM to set the active nav item, the page title and the sidebar counts.
 * Because it mutated markup React owned, hydration failed on every page: React
 * threw away the server HTML, re-rendered the whole document, and in doing so
 * re-created the script element through innerHTML, which browsers never
 * execute. The result was that no page ever got its own title, no nav item was
 * ever highlighted, the counts stayed blank and the menu button did nothing.
 * Rendering all of it from React fixes the mismatch and the behaviour together.
 */

type NavItem = { href: string; icon: string; label: string; count?: 'tasks' | 'courses' };

const PLAN: NavItem[] = [
  { href: '/', icon: '●', label: 'Today' },
  { href: '/week-plan', icon: '▦', label: 'This week' },
  { href: '/tasks', icon: '✓', label: 'Tasks', count: 'tasks' },
];
const SEMESTER: NavItem[] = [
  { href: '/courses', icon: '▤', label: 'Courses', count: 'courses' },
  { href: '/notes', icon: '≡', label: 'Notes' },
  { href: '/calendar', icon: '□', label: 'Calendar' },
];
const PROGRESS: NavItem[] = [
  { href: '/log', icon: '+', label: 'Log a session' },
  { href: '/review', icon: '◒', label: 'Review' },
];

const PAGES: Record<string, [string, string]> = {
  '/': ['Today', 'What is next, what remains, and how the day is shaping up.'],
  '/week-plan': ['This week', 'Balance the week before the week balances you.'],
  '/tasks': ['Tasks', 'Assignments grouped around what needs attention.'],
  '/courses': ['Courses', 'Your semester, course by course.'],
  '/notes': ['Notes', 'Notebooks, sections and pages, searchable by your assistant.'],
  '/calendar': ['Calendar', 'Classes, deadlines, exams, and study commitments.'],
  '/log': ['Log a session', 'Record the work while the details are still fresh.'],
  '/review': ['Review', 'See where your time went and what your pace says.'],
  '/settings': ['Settings', 'Set the assumptions the tracker uses to plan your work.'],
  '/backlog': ['Backlog', 'Everything waiting to be scheduled.'],
  '/planner': ['Planner', 'The next seven days, grouped by date.'],
  '/wizard': ['Course setup', 'Build a course from a syllabus.'],
  '/help': ['Help', 'How the tracker plans, estimates, and records your work.'],
};

const ADD_ACTION: Record<string, [string, string]> = {
  '/courses': ['Add course', '/courses#add-course'],
  '/notes': ['Add notes', '/notes'],
  '/log': ['View tasks', '/tasks'],
};

function normalize(pathname: string): string {
  if (!pathname) return '/';
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

function hoursLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h${String(safe % 60).padStart(2, '0')}`;
}

function startOfWeek(): Date {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((now.getDay() + 6) % 7));
  return start;
}

function readWeeklyTargetMinutes(): number {
  if (typeof window === 'undefined') return 1440;
  try {
    // The week planner stores explicit goals; Stats stores a simple hour count.
    const goals = JSON.parse(window.localStorage.getItem('weeklyGoalsV1') || '[]');
    const global = Array.isArray(goals) ? goals.find((goal: any) => goal?.scope === 'global') : null;
    if (global?.weeklyMinutes > 0) return Number(global.weeklyMinutes);
  } catch {}
  try {
    const hours = parseFloat(window.localStorage.getItem('weeklyGoalHours') || '');
    if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  } catch {}
  return 1440;
}

export default function SiteChrome({ children, brandMark }: { children: React.ReactNode; brandMark: string }) {
  const pathname = normalize(usePathname() || '/');
  const [sideOpen, setSideOpen] = useState(false);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [courseCount, setCourseCount] = useState<number | null>(null);
  const [weekMinutes, setWeekMinutes] = useState(0);
  const [targetMinutes, setTargetMinutes] = useState(1440);
  const [subtitleOverride, setSubtitleOverride] = useState<string | null>(null);
  // Derived from the calendar and the configured semesters, so it stays
  // honest about whether the term has actually started.
  const { term, label: termLabel } = useTerm();

  const [title, defaultSubtitle] = PAGES[pathname]
    || ['Law School Tracker', 'Structure your workload, stay on pace, and review your progress.'];
  const [addLabel, addHref] = ADD_ACTION[pathname] || ['Add task', '/tasks#add-task'];

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      const data = await res.json();
      setTaskCount((data?.tasks || []).filter((task: any) => task?.status !== 'done').length);
    } catch {}
  }, []);

  const loadCourses = useCallback(async () => {
    try {
      const res = await fetch('/api/courses', { cache: 'no-store' });
      const data = await res.json();
      const all = (data?.courses || []) as Array<{ semester?: string | null; year?: number | null }>;
      // Count this semester's courses, not every course ever taken, so the
      // badge matches what the Courses page shows by default.
      setCourseCount(term
        ? all.filter(c => courseInTerm(c, term) || !c.semester || !c.year).length
        : all.length);
    } catch {}
  }, [term]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' });
      const data = await res.json();
      const start = startOfWeek();
      // Sessions record their timestamp in `when`; the old script looked for
      // `startedAt`/`date`, which sessions never had.
      const minutes = (data?.sessions || []).reduce((sum: number, session: any) => {
        const when = new Date(session?.when || session?.createdAt || 0);
        return when >= start ? sum + (Number(session?.minutes) || 0) : sum;
      }, 0);
      setWeekMinutes(minutes);
    } catch {}
  }, []);

  useEffect(() => {
    setTargetMinutes(readWeeklyTargetMinutes());
    void loadCounts();
    void loadCourses();
    void loadSessions();
    const offTasks = onTasksChanged(() => void loadCounts());
    const offCourses = onCoursesChanged(() => void loadCourses());
    const offSessions = onSessionsChanged(() => void loadSessions());
    const timer = window.setInterval(() => {
      void loadCounts();
      void loadCourses();
      void loadSessions();
      setTargetMinutes(readWeeklyTargetMinutes());
    }, 60000);
    return () => { offTasks(); offCourses(); offSessions(); window.clearInterval(timer); };
  }, [loadCounts, loadCourses, loadSessions]);


  useEffect(() => onPageSubtitle(setSubtitleOverride), []);
  useEffect(() => { setSubtitleOverride(null); setSideOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.dataset.route = pathname;
  }, [pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSideOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const percent = useMemo(
    () => Math.min(100, Math.round((weekMinutes / Math.max(1, targetMinutes)) * 100)),
    [weekMinutes, targetMinutes],
  );
  const weekCopy = percent >= 100
    ? 'Weekly target reached.'
    : percent >= 70
      ? 'On pace. Keep the remaining work deliberate.'
      : 'The week still has room. Schedule the next block.';

  function openSearch() {
    openCommandPalette();
  }

  const renderGroup = (label: string, items: NavItem[]) => (
    <div className="lst-group">
      <div className="lst-label">{label}</div>
      <div className="lst-list">
        {items.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const count = item.count === 'tasks' ? taskCount : item.count === 'courses' ? courseCount : null;
          return (
            <Link key={item.href} href={item.href} className={`lst-nav${active ? ' active' : ''}`}>
              <span className="lst-icon" aria-hidden="true">{item.icon}</span>
              <span className="lst-name">{item.label}</span>
              {item.count ? <span className="lst-count">{count ? String(count) : ''}</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={`lst-shell${sideOpen ? ' side-open' : ''}`}>
      <aside className="lst-sidebar">
        <div className="lst-brand">
          <div className="lst-wordmark">Law School Tracker</div>
          {termLabel ? <div className="lst-term">{termLabel}</div> : null}
        </div>
        <nav>
          {renderGroup('Plan', PLAN)}
          {renderGroup('Semester', SEMESTER)}
          {renderGroup('Progress', PROGRESS)}
        </nav>
        <div className="lst-grow" />
        <div className="lst-week">
          <b>This week</b>
          <div className="lst-week-value">{hoursLabel(weekMinutes)} / {hoursLabel(targetMinutes)}</div>
          <div className="lst-track"><span className="lst-fill" style={{ width: `${percent}%` }} /></div>
          <div className="lst-week-copy">{weekCopy}</div>
        </div>
        <div className="lst-bottom lst-list">
          <Link href="/help" className={`lst-nav${pathname === '/help' ? ' active' : ''}`}>
            <span className="lst-icon">?</span><span className="lst-name">Help</span>
          </Link>
          <Link href="/settings" className={`lst-nav${pathname.startsWith('/settings') ? ' active' : ''}`}>
            <span className="lst-icon">⚙</span><span className="lst-name">Settings</span>
          </Link>
        </div>
      </aside>

      <button className="lst-scrim" aria-label="Close navigation" onClick={() => setSideOpen(false)} />

      <div className="lst-work">
        <img className="lst-home-mark" src={brandMark} alt="" aria-hidden="true" />
        <header className="lst-top">
          <button className="lst-menu" type="button" aria-label="Open navigation" onClick={() => setSideOpen(open => !open)}>☰</button>
          <div className="lst-heading">
            <h1 className="lst-title">{title}</h1>
            <p className="lst-sub">{subtitleOverride || defaultSubtitle}</p>
          </div>
          <div className="lst-actions">
            <button className="lst-search" type="button" onClick={openSearch}>
              <span>Search or jump to…</span><kbd>⌘K</kbd>
            </button>
            <Link href={addHref} className="lst-add">{addLabel}</Link>
          </div>
        </header>
        <main className="lst-content">{children}</main>
      </div>
    </div>
  );
}
