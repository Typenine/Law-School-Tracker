'use client';

import { useCallback, useEffect, useState } from 'react';
import { sanitizeNoteHtml } from '@/lib/notes/htmlUtils';

type PasteMode = 'keep' | 'merge' | 'plain';

type PendingPaste = {
  editor: HTMLElement;
  range: Range;
  html: string;
  text: string;
  left: number;
  top: number;
};

const SUPPORTED_TAGS = new Set([
  'P', 'DIV', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE',
  'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'A', 'HR', 'SUP', 'SUB',
]);

const SAFE_STYLE_PROPERTIES = new Set([
  'font-weight', 'font-style', 'font-family', 'font-size', 'line-height',
  'text-decoration', 'text-decoration-line', 'text-align', 'vertical-align',
  'color', 'background-color', 'white-space', 'list-style', 'list-style-type',
  'list-style-position',
  'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
  'padding-left', 'padding-right',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width',
]);

function unwrap(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
}

function safeHref(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed;
  return '';
}

function copyFontFormatting(font: HTMLElement) {
  const replacement = document.createElement('span');
  const color = font.getAttribute('color');
  const face = font.getAttribute('face');
  const size = font.getAttribute('size');
  if (color) replacement.style.color = color;
  if (face) replacement.style.fontFamily = face;
  if (size && /^\d+$/.test(size)) {
    const px = ({ '1': 10, '2': 13, '3': 16, '4': 18, '5': 24, '6': 32, '7': 48 } as Record<string, number>)[size];
    if (px) replacement.style.fontSize = `${px}px`;
  }
  while (font.firstChild) replacement.appendChild(font.firstChild);
  font.replaceWith(replacement);
}

function cleanSourceHtml(rawHtml: string, merge: boolean): string {
  const template = document.createElement('template');
  template.innerHTML = sanitizeNoteHtml(rawHtml);

  // Image-only clipboard pastes still use the editor's existing upload path.
  // Remote images embedded in source HTML are stripped rather than becoming
  // tracking pixels inside a note.
  template.content.querySelectorAll('img').forEach(image => image.remove());
  template.content.querySelectorAll('font').forEach(font => copyFontFormatting(font as HTMLElement));

  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (!SUPPORTED_TAGS.has(element.tagName)) {
      unwrap(element);
      continue;
    }

    const htmlElement = element as HTMLElement;
    const allowedAttributes = new Set<string>();
    if (element.tagName === 'A') allowedAttributes.add('href');
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      allowedAttributes.add('colspan');
      allowedAttributes.add('rowspan');
    }
    if (element.tagName === 'OL') allowedAttributes.add('start');
    if (element.tagName === 'LI') allowedAttributes.add('value');
    if (!merge && (element.tagName === 'UL' || element.tagName === 'OL')) allowedAttributes.add('type');
    if (!merge) allowedAttributes.add('style');

    for (const attribute of Array.from(element.attributes)) {
      if (!allowedAttributes.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }

    if (element.tagName === 'A') {
      const href = safeHref(element.getAttribute('href') || '');
      if (href) element.setAttribute('href', href);
      else element.removeAttribute('href');
    }

    if (merge) {
      htmlElement.removeAttribute('style');
      continue;
    }

    const style = htmlElement.style;
    for (const property of Array.from(style)) {
      const value = style.getPropertyValue(property);
      if (!SAFE_STYLE_PROPERTIES.has(property.toLowerCase()) || /url\s*\(|expression\s*\(|javascript:|behavior\s*:/i.test(value)) {
        style.removeProperty(property);
      }
    }

    // A lot of web/Word clipboard HTML uses `list-style: none` because the
    // source page supplies its marker with external CSS or a pseudo-element.
    // That CSS does not travel with a paste, leaving a real <ul>/<ol> whose
    // marker is invisible. Drop only the marker-suppressing part so the Notes
    // document stylesheet can provide a visible bullet/number fallback.
    if (element.tagName === 'UL' || element.tagName === 'OL') {
      if (style.getPropertyValue('list-style-type').trim().toLowerCase() === 'none') {
        style.removeProperty('list-style-type');
      }
      const shorthand = style.getPropertyValue('list-style').trim().toLowerCase();
      if (shorthand.split(/\s+/).includes('none')) style.removeProperty('list-style');
    }

    if (!style.length) htmlElement.removeAttribute('style');
  }

  if (merge) {
    // Once source styling is removed, spans have no job. Unwrapping them lets
    // the pasted material inherit the Notes editor's typography and colors.
    template.content.querySelectorAll('span').forEach(span => unwrap(span));
  }

  return template.innerHTML || '<p><br></p>';
}

function insertHtmlAtRange(editor: HTMLElement, range: Range, html: string) {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);

  let inserted = false;
  try { inserted = document.execCommand('insertHTML', false, html); } catch {}
  if (!inserted) {
    range.deleteContents();
    const template = document.createElement('template');
    template.innerHTML = html;
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertTextAtRange(editor: HTMLElement, range: Range, text: string) {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);

  let inserted = false;
  try { inserted = document.execCommand('insertText', false, text); } catch {}
  if (!inserted) {
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function PasteOptions() {
  const [pending, setPending] = useState<PendingPaste | null>(null);

  const choose = useCallback((mode: PasteMode) => {
    if (!pending) return;
    const current = pending;
    setPending(null);
    if (mode === 'plain') insertTextAtRange(current.editor, current.range, current.text);
    else insertHtmlAtRange(current.editor, current.range, cleanSourceHtml(current.html, mode === 'merge'));
  }, [pending]);

  // Rich lists should behave like an outline. The editor's built-in key handler
  // already reserves Tab for table-cell navigation; everywhere else a Tab on a
  // real <li> nests that item one level deeper, while Shift+Tab moves it back.
  // Listening in capture phase keeps the browser from tabbing focus out of the
  // contenteditable before the React editor handler gets a chance to respond.
  useEffect(() => {
    const onListTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const editor = target?.closest<HTMLElement>('.nb-canvas[contenteditable="true"]');
      if (!editor) return;

      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      if (!anchor || !editor.contains(anchor)) return;
      const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
      const item = anchorElement?.closest('li');
      if (!item || !editor.contains(item)) return;
      // Inside a table, Tab remains spreadsheet-style cell navigation.
      if (item.closest('td, th')) return;

      event.preventDefault();
      editor.focus();
      try { document.execCommand(event.shiftKey ? 'outdent' : 'indent', false); } catch {}
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    };

    document.addEventListener('keydown', onListTab, true);
    return () => document.removeEventListener('keydown', onListTab, true);
  }, []);

  // Notes used to treat a simple tab/window switch as if the page were closing:
  // visibilitychange fired flushOnExit(), sendBeacon saved a new DB timestamp,
  // and the still-open editor kept the old timestamp. The next autosave then
  // accused that same tab of being a different editor. Suppress only that
  // visibility-only Notes beacon; a real pagehide still gets the last-chance
  // save, so closing or navigating away keeps the durability protection.
  useEffect(() => {
    if (typeof navigator.sendBeacon !== 'function') return;
    const original = navigator.sendBeacon.bind(navigator);
    let pageHiding = false;

    const onPageHide = () => { pageHiding = true; };
    const onPageShow = () => { pageHiding = false; };
    const guarded = (url: string | URL, data?: BodyInit | null) => {
      let pathname = '';
      try { pathname = new URL(String(url), window.location.href).pathname; } catch {}
      const noteSave = /^\/api\/notes\/[^/]+$/.test(pathname);
      if (noteSave && document.visibilityState === 'hidden' && !pageHiding) {
        // sendBeacon callers only need a boolean saying the request was queued.
        // Returning true here prevents the self-conflicting write while keeping
        // the editor dirty so normal autosave runs when the tab is active again.
        return true;
      }
      return original(url, data);
    };

    const ownDescriptor = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
    try {
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        writable: true,
        value: guarded,
      });
    } catch {
      return;
    }

    window.addEventListener('pagehide', onPageHide, { capture: true });
    window.addEventListener('pageshow', onPageShow, { capture: true });
    return () => {
      window.removeEventListener('pagehide', onPageHide, { capture: true });
      window.removeEventListener('pageshow', onPageShow, { capture: true });
      try {
        if (ownDescriptor) Object.defineProperty(navigator, 'sendBeacon', ownDescriptor);
        else Reflect.deleteProperty(navigator, 'sendBeacon');
      } catch {}
    };
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editor = target?.closest<HTMLElement>('.nb-canvas[contenteditable="true"]');
      if (!editor || !event.clipboardData) return;

      const image = Array.from(event.clipboardData.items || [])
        .some(item => item.kind === 'file' && item.type.startsWith('image/'));
      if (image) return;

      const html = event.clipboardData.getData('text/html');
      if (!html.trim()) return;

      const text = event.clipboardData.getData('text/plain');
      const selection = window.getSelection();
      let range: Range;
      if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        range = selection.getRangeAt(0).cloneRange();
      } else {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }

      const rect = range.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const width = 390;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left || editorRect.left + 24));
      const top = Math.max(12, Math.min(window.innerHeight - 205, (rect.bottom || editorRect.top + 48) + 10));

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPending({ editor, range, html, text, left, top });
    };

    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setPending(null); return; }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); choose('keep'); return; }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); choose('merge'); return; }
      if (event.key.toLowerCase() === 't') { event.preventDefault(); choose('plain'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, choose]);

  if (!pending) return null;

  return (
    <div
      className="notes-paste-options"
      role="dialog"
      aria-label="Paste formatting"
      style={{ left: pending.left, top: pending.top }}
      onMouseDown={event => event.preventDefault()}
    >
      <div className="notes-paste-title">Paste formatting</div>
      <button type="button" onClick={() => choose('keep')}>
        <strong>Keep formatting</strong><span>Fonts, sizes, colors, lists, tables and links</span><kbd>K</kbd>
      </button>
      <button type="button" onClick={() => choose('merge')}>
        <strong>Merge formatting</strong><span>Keep structure and emphasis; use note styling</span><kbd>M</kbd>
      </button>
      <button type="button" onClick={() => choose('plain')}>
        <strong>Plain text</strong><span>Paste only the text</span><kbd>T</kbd>
      </button>
      <div className="notes-paste-hint">Esc cancels the paste</div>
      <style jsx global>{`
        .notes-paste-options{position:fixed;z-index:4000;width:390px;max-width:calc(100vw - 24px);padding:8px;border:1px solid var(--line2);border-radius:10px;background:#0b1727;box-shadow:0 18px 48px rgba(0,0,0,.48)}
        .notes-paste-title{padding:5px 8px 8px;color:var(--label);font:500 10px/1 'IBM Plex Mono',monospace;letter-spacing:.11em;text-transform:uppercase}
        .notes-paste-options button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--text2);text-align:left;cursor:pointer}
        .notes-paste-options button:hover,.notes-paste-options button:focus{outline:none;background:var(--s3);color:var(--text)}
        .notes-paste-options button strong{grid-column:1;font-size:12.5px;font-weight:600}
        .notes-paste-options button span{grid-column:1;color:var(--muted);font-size:11px;line-height:1.35}
        .notes-paste-options button kbd{grid-column:2;grid-row:1 / span 2;align-self:center;padding:3px 6px;border:1px solid var(--btn);border-radius:4px;background:var(--s1);color:var(--muted);font-size:10px}
        .notes-paste-hint{padding:7px 8px 3px;color:var(--muted2);font-size:10.5px}
      `}</style>
    </div>
  );
}
