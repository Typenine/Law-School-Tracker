'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { onPageSubtitle } from '@/lib/chromeBus';
import { onTasksChanged } from '@/lib/taskBus';
import { onCoursesChanged } from '@/lib/coursesBus';
import { onSessionsChanged } from '@/lib/sessionsBus';
import { openCommandPalette } from '@/components/CommandPalette';
import { useTerm } from '@/lib/useTerm';
import { courseInTerm } from '@/lib/semester';
import ConnectivityStatus from '@/components/ConnectivityStatus';
import CourseCommandCenter from '@/components/CourseCommandCenter';
import TaskDeepLinkDrawer from '@/components/TaskDeepLinkDrawer';
import TaskContextStrip from '@/components/TaskContextStrip';
import WeeklyReviewSummary from '@/components/WeeklyReviewSummary';

type NavItem = { href: string; icon: string; label: string; count?: 'tasks' | 'courses' };

const PLAN: NavItem[] = [
  { href: '/', icon: '●', label: 'Today' },
  { href: '/week-plan', icon: '▦', label: 'This week' },
  { href: '/tasks', icon: '✓', label: 'Tasks', count: 'tasks' },
  { href: '/reading', icon: '▥', label: 'Reading' },
];
const SEMESTER: NavItem[] = [
  { href: '/courses', icon: '▤', label: 'Courses', count: 'courses' },
  { href: '/notes', icon: '≡', label: 'Notes' },
  { href: '/calendar', icon: '□', label: 'Calendar' },
];
const PROGRESS: NavItem[] = [
  { href: '/log', icon: '+', label: 'Log a session' },
  { href: '/review', icon: '◒', label: 'Review' },
  { href: '/archive', icon: '↧', label: 'Archive & backup' },
];

const PAGES: Record<string, [string, string]> = {
  '/': ['Today', 'What is next, what remains, and how the day is shaping up.'],
  '/week-plan': ['This week', 'Balance the week before the week balances you.'],
  '/tasks': ['Tasks', 'Assignments grouped around what needs attention.'],
  '/reading': ['Reading', 'Assigned pages, progress, pace, linked notes, and the time still required.'],
  '/courses': ['Courses', 'Your semester, course by course.'],
  '/notes': ['Notes', 'Notebooks, sections and pages, searchable by your assistant.'],
  '/calendar': ['Calendar', 'Classes, deadlines, exams, and study commitments.'],
  '/log': ['Log a session', 'Record the work while the details are still fresh.'],
  '/review': ['Review', 'Actual work, plan accuracy, course balance, pace, focus, and risk.'],
  '/archive': ['Archive & backup', 'Freeze semesters and keep a restorable copy of the workspace.'],
  '/settings': ['Settings', 'Set the assumptions the tracker uses to plan your work.'],
  '/help': ['Help', 'How the tracker plans, estimates, and records your work.'],
};

const ADD_ACTION: Record<string, [string, string]> = {
  '/courses': ['Add course', '/courses#add-course'],
  '/notes': ['Add notes', '/notes'],
  '/log': ['View tasks', '/tasks'],
  '/archive': ['Add task', '/tasks#add-task'],
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

export default function SiteChrome({ children, brandMark }: { children: React.ReactNode; brandMark: string }) {
  const pathname = normalize(usePathname() || '/');
  const [sideOpen, setSideOpen] = useState(false);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [courseCount, setCourseCount] = useState<number | null>(null);
  const [weekMinutes, setWeekMinutes] = useState(0);
  const [targetMinutes, setTargetMinutes] = useState(1440);
  const [riskCount, setRiskCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [subtitleOverride, setSubtitleOverride] = useState<string | null>(null);
  const { term, label: termLabel } = useTerm();

  const exactPage = PAGES[pathname];
  const courseDetail = pathname.match(/^\/courses\/([^/]+)$/);
  const [title, defaultSubtitle] = exactPage || (courseDetail ? ['Course', 'Assignments, materials, coverage, and progress in one place.'] : ['Law School Tracker', 'Structure your workload, stay on pace, and review your progress.']);
  const [addLabel, addHref] = ADD_ACTION[pathname] || ['Add task', '/tasks#add-task'];

  const loadTaskSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/workspace', { cache: 'no-store' });
      const data = await res.json();
      const summary = data?.summary || {};
      setTaskCount(Number(summary.open) || 0);
      setRiskCount(Number(summary.atRisk) || 0);
      setBlockedCount(Number(summary.blocked) || 0);
    } catch {}
  }, []);

  const loadCourses = useCallback(async () => {
    try {
      const res = await fetch('/api/courses', { cache: 'no-store' });
      const data = await res.json();
      const all = (data?.courses || []) as Array<{ semester?: string | null; year?: number | null }>;
      setCourseCount(term ? all.filter(c => courseInTerm(c, term) || !c.semester || !c.year).length : all.length);
    } catch {}
  }, [term]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' });
      const data = await res.json();
      const start = startOfWeek();
      const minutes = (data?.sessions || []).reduce((sum: number, session: any) => {
        const when = new Date(session?.when || session?.createdAt || 0);
        return when >= start ? sum + (Number(session?.minutes) || 0) : sum;
      }, 0);
      setWeekMinutes(minutes);
    } catch {}
  }, []);

  const loadServerSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings?keys=weeklyGoalsV1,weeklyGoalHours', { cache: 'no-store' });
      const data = await res.json();
      const settings = data?.settings || {};
      const goals = Array.isArray(settings.weeklyGoalsV1) ? settings.weeklyGoalsV1 : [];
      const global = goals.find((goal: any) => goal?.scope === 'global' && Number(goal?.weeklyMinutes) > 0);
      if (global) { setTargetMinutes(Number(global.weeklyMinutes)); return; }
      const hours = Number(settings.weeklyGoalHours);
      if (hours > 0) { setTargetMinutes(Math.round(hours * 60)); return; }
      setTargetMinutes(1440);
    } catch {}
  }, []);

  useEffect(() => {
    void loadTaskSummary(); void loadCourses(); void loadSessions(); void loadServerSettings();
    const offTasks = onTasksChanged(() => void loadTaskSummary());
    const offCourses = onCoursesChanged(() => void loadCourses());
    const offSessions = onSessionsChanged(() => void loadSessions());
    const timer = window.setInterval(() => {
      void loadTaskSummary(); void loadCourses(); void loadSessions(); void loadServerSettings();
    }, 60000);
    return () => { offTasks(); offCourses(); offSessions(); window.clearInterval(timer); };
  }, [loadTaskSummary, loadCourses, loadSessions, loadServerSettings]);

  useEffect(() => onPageSubtitle(setSubtitleOverride), []);
  useEffect(() => { setSubtitleOverride(null); setSideOpen(false); }, [pathname]);
  useEffect(() => { document.body.dataset.route = pathname; }, [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSideOpen(false); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  const percent = useMemo(() => Math.min(100, Math.round((weekMinutes / Math.max(1, targetMinutes)) * 100)), [weekMinutes, targetMinutes]);
  const weekCopy = riskCount > 0
    ? `${riskCount} at risk${blockedCount ? ` · ${blockedCount} blocked` : ''}.`
    : percent >= 100 ? 'Weekly target reached.'
      : percent >= 70 ? 'On pace. Keep the remaining work deliberate.'
      : blockedCount ? `${blockedCount} blocked task${blockedCount === 1 ? '' : 's'} need attention.`
      : 'The week still has room. Schedule the next block.';

  const renderGroup = (label: string, items: NavItem[]) => <div className="lst-group">
    <div className="lst-label">{label}</div>
    <div className="lst-list">{items.map(item => {
      const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
      const count = item.count === 'tasks' ? taskCount : item.count === 'courses' ? courseCount : null;
      return <Link key={item.href} href={item.href} className={`lst-nav${active ? ' active' : ''}`}>
        <span className="lst-icon" aria-hidden="true">{item.icon}</span><span className="lst-name">{item.label}</span>{item.count ? <span className="lst-count">{count ? String(count) : ''}</span> : null}
      </Link>;
    })}</div>
  </div>;

  const taskContextMode = pathname === '/' ? 'today' : pathname === '/calendar' ? 'calendar' : pathname === '/week-plan' ? 'week' : null;

  return <div className={`lst-shell${sideOpen ? ' side-open' : ''}`}>
    <aside className="lst-sidebar">
      <div className="lst-brand"><div className="lst-wordmark">Law School Tracker</div>{termLabel ? <div className="lst-term">{termLabel}</div> : null}</div>
      <nav>{renderGroup('Plan', PLAN)}{renderGroup('Semester', SEMESTER)}{renderGroup('Progress', PROGRESS)}</nav>
      <div className="lst-grow" />
      <div className="lst-week"><b>This week</b><div className="lst-week-value">{hoursLabel(weekMinutes)} / {hoursLabel(targetMinutes)}</div><div className="lst-track"><span className="lst-fill" style={{ width: `${percent}%` }} /></div><div className="lst-week-copy">{weekCopy}</div></div>
      <div className="lst-bottom lst-list"><Link href="/help" className={`lst-nav${pathname === '/help' ? ' active' : ''}`}><span className="lst-icon">?</span><span className="lst-name">Help</span></Link><Link href="/settings" className={`lst-nav${pathname.startsWith('/settings') ? ' active' : ''}`}><span className="lst-icon">⚙</span><span className="lst-name">Settings</span></Link></div>
    </aside>

    <button className="lst-scrim" aria-label="Close navigation" onClick={() => setSideOpen(false)} />
    <div className="lst-work">
      <img className="lst-home-mark" src={brandMark} alt="" aria-hidden="true" />
      <header className="lst-top">
        <button className="lst-menu" type="button" aria-label="Open navigation" onClick={() => setSideOpen(open => !open)}>☰</button>
        <div className="lst-heading"><h1 className="lst-title">{title}</h1><p className="lst-sub">{subtitleOverride || defaultSubtitle}</p></div>
        <div className="lst-actions"><button className="lst-search" type="button" onClick={openCommandPalette}><span>Search or jump to…</span><kbd>⌘K</kbd></button><Link href={addHref} className="lst-add">{addLabel}</Link></div>
      </header>
      <main className="lst-content">
        {taskContextMode ? <TaskContextStrip mode={taskContextMode} /> : null}
        {courseDetail ? <CourseCommandCenter courseId={decodeURIComponent(courseDetail[1])} /> : null}
        {pathname === '/review' ? <WeeklyReviewSummary /> : null}
        {children}
      </main>
    </div>
    <ConnectivityStatus />
    <Suspense fallback={null}><TaskDeepLinkDrawer /></Suspense>
  </div>;
}
