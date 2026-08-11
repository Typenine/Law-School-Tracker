/**
 * The single source of truth for "what color represents this course".
 *
 * This used to be three independent implementations (here, in Settings, and
 * in Week Plan) with different hash functions and color spaces, so the same
 * course could show a different color depending which page you were on.
 * Everywhere that needs a course color now goes through `resolveCourseColor`.
 */

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Deterministic color for a course name, used only when nothing has picked one explicitly. */
export function fallbackCourseColor(name?: string | null): string {
  const key = (name || '').trim().toLowerCase();
  if (!key) return '#6b7280';
  return hslToHex(hashString(key) % 360, 70, 55);
}

/** What to actually render: the course's own color if set, else the deterministic fallback. */
export function resolveCourseColor(course?: { color?: string | null; title?: string | null } | null): string {
  const explicit = course?.color?.trim();
  return explicit || fallbackCourseColor(course?.title);
}
