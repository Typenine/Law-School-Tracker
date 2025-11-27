/**
 * Page Range Utilities
 * 
 * Handles parsing and manipulation of page ranges like "241-250, 107-111"
 */

export type PageRange = { start: number; end: number };

/**
 * Parse a page range string into an array of ranges
 * Input: "241-250, 107-111" or "p. 241-250, 107-111" or "241–250, 107–111"
 * Output: [{ start: 241, end: 250 }, { start: 107, end: 111 }]
 */
export function parsePageRanges(input: string): PageRange[] {
  if (!input) return [];
  
  // Remove common prefixes
  let s = input.replace(/^p(?:ages?)?\.?\s*/i, '').trim();
  
  // Normalize dashes (en-dash, em-dash to hyphen)
  s = s.replace(/[–—]/g, '-');
  
  // Split by comma or semicolon
  const parts = s.split(/[,;]/).map(p => p.trim()).filter(Boolean);
  
  const ranges: PageRange[] = [];
  for (const part of parts) {
    // Try to parse as range (e.g., "241-250")
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        ranges.push({ start, end });
      }
      continue;
    }
    
    // Try to parse as single page (e.g., "241")
    const singleMatch = part.match(/^(\d+)$/);
    if (singleMatch) {
      const page = parseInt(singleMatch[1], 10);
      if (!isNaN(page)) {
        ranges.push({ start: page, end: page });
      }
    }
  }
  
  return ranges;
}

/**
 * Format page ranges back to string
 * Input: [{ start: 241, end: 250 }, { start: 107, end: 111 }]
 * Output: "241–250, 107–111"
 */
export function formatPageRanges(ranges: PageRange[]): string {
  if (!ranges.length) return '';
  return ranges.map(r => r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`).join(', ');
}

/**
 * Count total pages in ranges
 */
export function countPages(ranges: PageRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}

/**
 * Count pages from a title string containing page ranges
 */
export function countPagesFromTitle(title: string): number {
  const match = title.match(/p(?:ages?)?\.?\s*([0-9,\s–-]+(?:\s*,\s*[0-9–-]+)*)/i);
  if (!match) return 0;
  const ranges = parsePageRanges(match[1]);
  return countPages(ranges);
}

/**
 * Extract page ranges string from a title
 */
export function extractPageRangesFromTitle(title: string): string | null {
  const match = title.match(/p(?:ages?)?\.?\s*([0-9,\s–-]+(?:\s*,\s*[0-9–-]+)*)/i);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Subtract completed pages from ranges
 * 
 * Example:
 *   ranges: [{ start: 241, end: 250 }, { start: 107, end: 111 }]
 *   completedPages: "241-247"
 *   result: [{ start: 248, end: 250 }, { start: 107, end: 111 }]
 */
export function subtractPages(ranges: PageRange[], completedInput: string): PageRange[] {
  const completed = parsePageRanges(completedInput);
  if (!completed.length) return ranges;
  
  // Create a set of all completed page numbers
  const completedSet = new Set<number>();
  for (const c of completed) {
    for (let p = c.start; p <= c.end; p++) {
      completedSet.add(p);
    }
  }
  
  // Filter out completed pages from each range
  const result: PageRange[] = [];
  for (const r of ranges) {
    let currentStart: number | null = null;
    
    for (let p = r.start; p <= r.end + 1; p++) {
      const isCompleted = completedSet.has(p) || p > r.end;
      
      if (!isCompleted && currentStart === null) {
        currentStart = p;
      } else if (isCompleted && currentStart !== null) {
        result.push({ start: currentStart, end: p - 1 });
        currentStart = null;
      }
    }
  }
  
  return result;
}

/**
 * Update a task title with new remaining page ranges
 */
export function updateTitleWithRemainingPages(title: string, remainingRanges: PageRange[]): string {
  if (!remainingRanges.length) {
    // No pages remaining - remove the page specification
    return title.replace(/\s*p(?:ages?)?\.?\s*[0-9,\s–-]+/gi, '').trim();
  }
  
  const formatted = formatPageRanges(remainingRanges);
  
  // Replace existing page range or append
  const hasPages = /p(?:ages?)?\.?\s*[0-9,\s–-]+/i.test(title);
  if (hasPages) {
    return title.replace(/p(?:ages?)?\.?\s*[0-9,\s–-]+/i, `p. ${formatted}`);
  }
  return title;
}

/**
 * Calculate estimated minutes based on page count and minutes-per-page
 */
export function estimateMinutesFromPages(pageCount: number, mpp: number = 3): number {
  return Math.round(pageCount * mpp);
}

/**
 * Validate that completed pages are within the task's page ranges
 */
export function validateCompletedPages(taskRanges: PageRange[], completedInput: string): { valid: boolean; error?: string } {
  const completed = parsePageRanges(completedInput);
  if (!completed.length) {
    return { valid: false, error: 'No valid pages specified' };
  }
  
  // Create a set of all valid page numbers from task
  const validSet = new Set<number>();
  for (const r of taskRanges) {
    for (let p = r.start; p <= r.end; p++) {
      validSet.add(p);
    }
  }
  
  // Check that all completed pages are in the valid set
  for (const c of completed) {
    for (let p = c.start; p <= c.end; p++) {
      if (!validSet.has(p)) {
        return { valid: false, error: `Page ${p} is not in the task's page range` };
      }
    }
  }
  
  return { valid: true };
}
