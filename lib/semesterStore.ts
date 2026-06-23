import type { SemesterInfo } from './types';
import { getSettings, patchSettings } from './storage';

const SETTING_KEY = 'semestersV1';

export function defaultSemesters(): SemesterInfo[] {
  const createdAt = new Date().toISOString();
  return [
    {
      id: 'fall-2026',
      name: 'Fall 2026',
      season: 'Fall',
      year: 2026,
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      isActive: true,
      windowsByDow: null,
      breaksByDow: null,
      createdAt,
    },
    {
      id: 'fall-2025',
      name: 'Fall 2025',
      season: 'Fall',
      year: 2025,
      startDate: '2025-08-01',
      endDate: '2025-12-31',
      isActive: false,
      windowsByDow: null,
      breaksByDow: null,
      createdAt,
    },
  ];
}

export async function listSemesters(): Promise<SemesterInfo[]> {
  const settings = await getSettings([SETTING_KEY]);
  const semesters = settings[SETTING_KEY];
  return Array.isArray(semesters) ? semesters : [];
}

export async function saveSemesters(semesters: SemesterInfo[]) {
  await patchSettings({ [SETTING_KEY]: semesters });
}

export async function getOrInitializeSemesters() {
  const existing = await listSemesters();
  if (existing.length) return existing;
  const seeded = defaultSemesters();
  await saveSemesters(seeded);
  return seeded;
}

export async function getActiveSemesterId() {
  const semesters = await getOrInitializeSemesters();
  return semesters.find(semester => semester.isActive)?.id || null;
}
