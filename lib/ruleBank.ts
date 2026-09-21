export type RuleConfidence = 1 | 2 | 3 | 4 | 5;
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface RuleBankEntry {
  id: string;
  course: string;
  topic: string;
  ruleText: string;
  source?: string | null;
  exceptions?: string | null;
  example?: string | null;
  confidence: RuleConfidence;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt?: string | null;
  nextReview: string; // YYYY-MM-DD
  reviewStep: number;
  reviewCount: number;
}

export const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 120, 180];

export function chicagoYmd(value: Date | string = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0);
  date.setDate(date.getDate() + days);
  return chicagoYmd(date);
}

export function dueForReview(rule: RuleBankEntry, today = chicagoYmd()): boolean {
  return Boolean(rule.nextReview && rule.nextReview <= today);
}

export function normalizeRuleBank(value: unknown): RuleBankEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .map((item: any) => ({
      id: String(item.id || ''),
      course: String(item.course || ''),
      topic: String(item.topic || ''),
      ruleText: String(item.ruleText || ''),
      source: item.source ? String(item.source) : null,
      exceptions: item.exceptions ? String(item.exceptions) : null,
      example: item.example ? String(item.example) : null,
      confidence: Math.min(5, Math.max(1, Number(item.confidence) || 3)) as RuleConfidence,
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
      lastReviewedAt: item.lastReviewedAt ? String(item.lastReviewedAt) : null,
      nextReview: /^\d{4}-\d{2}-\d{2}$/.test(String(item.nextReview || ''))
        ? String(item.nextReview)
        : addDaysYmd(chicagoYmd(), 1),
      reviewStep: Math.max(0, Math.round(Number(item.reviewStep) || 0)),
      reviewCount: Math.max(0, Math.round(Number(item.reviewCount) || 0)),
    }))
    .filter(item => item.id && item.ruleText);
}

export function reviewRule(rule: RuleBankEntry, rating: ReviewRating, today = chicagoYmd()): RuleBankEntry {
  let step = Math.max(0, rule.reviewStep || 0);
  let interval = 1;
  let confidence = rule.confidence || 3;

  if (rating === 'again') {
    step = 0;
    interval = 1;
    confidence = Math.max(1, confidence - 1) as RuleConfidence;
  } else if (rating === 'hard') {
    interval = Math.max(1, Math.round((REVIEW_INTERVALS[Math.min(step, REVIEW_INTERVALS.length - 1)] || 1) * 0.6));
  } else if (rating === 'good') {
    step = Math.min(REVIEW_INTERVALS.length - 1, step + 1);
    interval = REVIEW_INTERVALS[step];
    confidence = Math.min(5, confidence + 1) as RuleConfidence;
  } else {
    step = Math.min(REVIEW_INTERVALS.length - 1, step + 2);
    interval = REVIEW_INTERVALS[step];
    confidence = Math.min(5, confidence + 1) as RuleConfidence;
  }

  const now = new Date().toISOString();
  return {
    ...rule,
    confidence,
    reviewStep: step,
    reviewCount: (rule.reviewCount || 0) + 1,
    lastReviewedAt: now,
    nextReview: addDaysYmd(today, interval),
    updatedAt: now,
  };
}
