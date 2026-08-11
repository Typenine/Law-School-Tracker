/**
 * Pure text/HTML helpers for notes. Deliberately free of any server-only
 * dependency (no `pg`) so they can be imported from client components too -
 * e.g. to sanitize HTML before it is ever handed to `dangerouslySetInnerHTML`.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ENTITIES[char] || char);
}

/**
 * Reduce editor HTML to readable plain text. Block boundaries become newlines
 * and to-do items keep a visible checkbox so the exported/searched text still
 * reads the way the page looks.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<li([^>]*)data-checked="true"([^>]*)>/gi, '\n[x] ')
    .replace(/<li([^>]*)class="[^"]*nb-todo[^"]*"([^>]*)>/gi, '\n[ ] ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, '\n[image: $1]\n')
    .replace(/<img[^>]*>/gi, '\n[image]\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Turn stored plain text into editor HTML. Used once per legacy page: notes
 * written before the rich editor existed are markdown-ish, so headings, list
 * markers and checkboxes are recognised rather than shown as literal syntax.
 */
export function plainTextToHtml(text: string): string {
  if (!text || !text.trim()) return '<p><br></p>';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const openList = (type: 'ul' | 'ol', className = '') => {
    if (listType !== type) {
      closeList();
      out.push(`<${type}${className ? ` class="${className}"` : ''}>`);
      listType = type;
    }
  };

  const inline = (value: string) => escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const todo = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s+(.*)$/.exec(line);
    if (todo) {
      openList('ul', 'nb-todo-list');
      out.push(`<li class="nb-todo" data-checked="${todo[1].toLowerCase() === 'x'}">${inline(todo[2])}</li>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(4, Math.max(1, heading[1].length));
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      openList('ul');
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      openList('ol');
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('') || '<p><br></p>';
}

/**
 * Strip anything that should never round-trip through the editor. This is a
 * single-user private workspace, but pasted content can still carry scripts,
 * event handlers and remote resources.
 *
 * Also used client-side to sanitize the "yours, not saved yet" half of the
 * save-conflict dialog before it is rendered with `dangerouslySetInnerHTML` -
 * that copy comes straight from the live contenteditable DOM and never goes
 * through the server's sanitizer until (if) the user chooses to keep it.
 */
export function sanitizeNoteHtml(html: string): string {
  if (!html) return '<p><br></p>';
  const cleaned = html
    // Images are allowed, but only ones we serve: an arbitrary remote src is a
    // tracking pixel, and javascript:/data: are script vectors.
    .replace(/<img\b[^>]*>/gi, tag => {
      const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
      if (!/^https:\/\//i.test(src)) return '';
      const alt = /\salt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
      return `<img src="${src.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}">`;
    })
    .replace(/<\s*(script|style|iframe|object|embed|form|input|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|link|meta)\b[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
  return cleaned || '<p><br></p>';
}
