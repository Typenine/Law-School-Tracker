export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const BG_CLASSES = [
  'bg-rose-600', 'bg-pink-600', 'bg-fuchsia-600', 'bg-purple-600', 'bg-violet-600', 'bg-indigo-600', 'bg-blue-600', 'bg-sky-600', 'bg-cyan-600', 'bg-teal-600', 'bg-emerald-600', 'bg-green-600', 'bg-lime-600', 'bg-yellow-600', 'bg-amber-600', 'bg-orange-600', 'bg-red-600'
];
const TEXT_CLASSES = BG_CLASSES.map(c => c.replace('bg-', 'text-'));
const BORDER_CLASSES = BG_CLASSES.map(c => c.replace('bg-', 'border-'));

export function courseColorClass(course?: string | null, variant: 'bg' | 'text' | 'border' = 'bg'): string {
  const name = (course || '').trim();
  if (!name) return variant === 'bg' ? 'bg-slate-500' : variant === 'text' ? 'text-slate-300/70' : 'border-slate-500';
  const idx = hashString(name.toLowerCase()) % BG_CLASSES.length;
  if (variant === 'text') return TEXT_CLASSES[idx];
  if (variant === 'border') return BORDER_CLASSES[idx];
  return BG_CLASSES[idx];
}
