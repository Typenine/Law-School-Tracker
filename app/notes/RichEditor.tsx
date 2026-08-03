'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  /** Changing this reloads the canvas; it is the only time we write innerHTML. */
  pageId: string;
  initialHtml: string;
  onChange: (html: string) => void;
  onSaveNow: () => void;
  /** Uploads an image and returns its URL, or null if it could not be stored. */
  onUploadImage: (file: File) => Promise<string | null>;
};

const HIGHLIGHTS = [
  ['#fff3a3', 'Yellow'],
  ['#bdf0c8', 'Green'],
  ['#bcdcff', 'Blue'],
  ['#ffc9dd', 'Pink'],
  ['#ffd9b0', 'Orange'],
  ['#e0d0ff', 'Lilac'],
] as const;

const TEXT_COLORS = [
  ['#e8eef7', 'Default'],
  ['#ffd34d', 'Amber'],
  ['#7fc0ff', 'Blue'],
  ['#7fdca4', 'Green'],
  ['#ff9a8a', 'Red'],
  ['#c9a9ff', 'Purple'],
  ['#9fb2c9', 'Grey'],
] as const;

const FONTS = [
  ['', 'Default'],
  ['"IBM Plex Sans", system-ui, sans-serif', 'Sans'],
  ['Newsreader, Georgia, serif', 'Serif'],
  ['"IBM Plex Mono", monospace', 'Mono'],
] as const;

/** execCommand only understands sizes 1-7; these are the useful ones. */
const SIZES = [
  ['2', 'Small'],
  ['3', 'Normal'],
  ['4', 'Large'],
  ['5', 'Huge'],
] as const;

/**
 * OneNote-style canvas. The editor is deliberately uncontrolled: React writes
 * the HTML only when the page changes, and every keystroke after that is owned
 * by the DOM. Re-rendering the markup on each change would reset the caret to
 * the top of the page on every character.
 */
export default function RichEditor({ pageId, initialHtml, onChange, onSaveNow, onUploadImage }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [blockStyle, setBlockStyle] = useState('p');
  const [openMenu, setOpenMenu] = useState<'highlight' | 'color' | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = initialHtml || '<p><br></p>';
  }, [pageId, initialHtml]);

  useEffect(() => {
    function closeMenus() { setOpenMenu(null); setLinkOpen(false); }
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);

  const rememberSelection = useCallback((): Range | null => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    const saved = range.cloneRange();
    savedRangeRef.current = saved;
    return saved;
  }, []);

  const restoreSelection = useCallback((range = savedRangeRef.current) => {
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (editor) onChange(editor.innerHTML);
  }, [onChange]);

  const run = useCallback((command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(command, false, value);
    } catch {}
    emit();
  }, [emit]);

  const currentBlock = useCallback((): HTMLElement | null => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return null;
    let node: Node | null = selection.anchorNode;
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1 && /^(P|DIV|H1|H2|H3|H4|LI|BLOCKQUOTE|PRE)$/.test((node as HTMLElement).tagName)) {
        return node as HTMLElement;
      }
      node = node.parentNode;
    }
    return null;
  }, []);

  /** Turn the current block into a to-do item, or back into a paragraph. */
  const toggleTodo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const block = currentBlock();
    const listItem = block?.tagName === 'LI' ? block : null;

    if (listItem?.classList.contains('nb-todo')) {
      listItem.classList.remove('nb-todo');
      listItem.removeAttribute('data-checked');
      const list = listItem.parentElement;
      if (list && !list.querySelector('.nb-todo')) list.classList.remove('nb-todo-list');
      emit();
      return;
    }
    if (listItem) {
      listItem.classList.add('nb-todo');
      listItem.setAttribute('data-checked', 'false');
      listItem.parentElement?.classList.add('nb-todo-list');
      emit();
      return;
    }
    // Not in a list yet: make one, then tag the item.
    try {
      document.execCommand('insertUnorderedList');
    } catch {}
    const created = currentBlock();
    if (created?.tagName === 'LI') {
      created.classList.add('nb-todo');
      created.setAttribute('data-checked', 'false');
      created.parentElement?.classList.add('nb-todo-list');
    }
    emit();
  }, [currentBlock, emit]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const item = target.closest('li.nb-todo') as HTMLElement | null;
    if (!item) return;
    // The checkbox is a ::before box in the item's left gutter.
    const bounds = item.getBoundingClientRect();
    if (event.clientX - bounds.left > 24) return;
    event.preventDefault();
    item.setAttribute('data-checked', item.getAttribute('data-checked') === 'true' ? 'false' : 'true');
    emit();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const meta = event.metaKey || event.ctrlKey;
    if (!meta) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); onSaveNow(); return; }
    if (key === '1' && event.shiftKey) { event.preventDefault(); run('formatBlock', '<h1>'); return; }
    if (key === '2' && event.shiftKey) { event.preventDefault(); run('formatBlock', '<h2>'); return; }
    if (key === '3' && event.shiftKey) { event.preventDefault(); run('formatBlock', '<h3>'); return; }
    if (key === '1' && !event.shiftKey) { event.preventDefault(); toggleTodo(); return; }
    // Bold / italic / underline are handled natively by contenteditable.
  }

  const insertImage = useCallback(async (file: File) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const insertionPoint = rememberSelection();
    const url = await onUploadImage(file);
    if (!url) return;
    editor.focus();
    restoreSelection(insertionPoint);
    try {
      document.execCommand('insertHTML', false, `<img src="${url}" alt="${file.name.replace(/"/g, '')}">`);
    } catch {}
    emit();
  }, [emit, onUploadImage, rememberSelection, restoreSelection]);

  /**
   * Paste text as plain text so pasted PDFs and web pages do not import their
   * CSS, but let pasted screenshots through as images.
   */
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const image = Array.from(event.clipboardData.items || [])
      .find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (image) {
      const file = image.getAsFile();
      if (file) { event.preventDefault(); void insertImage(file); return; }
    }
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    document.execCommand('insertText', false, text);
    emit();
  }

  /** Dropping an image file onto the canvas adds it too. */
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    const file = Array.from(event.dataTransfer.files || []).find(f => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void insertImage(file);
  }

  function applyBlockStyle(value: string) {
    setBlockStyle(value);
    run('formatBlock', `<${value}>`);
  }

  const Button = ({ title, onClick, children, active }: {
    title: string; onClick: () => void; children: React.ReactNode; active?: boolean;
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`nb-tool${active ? ' is-active' : ''}`}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <div className="nb-editor-wrap">
      <div className="nb-ribbon" onClick={event => event.stopPropagation()}>
        <div className="nb-ribbon-group">
          <Button title="Undo (Ctrl+Z)" onClick={() => run('undo')}>↺</Button>
          <Button title="Redo (Ctrl+Y)" onClick={() => run('redo')}>↻</Button>
        </div>

        <div className="nb-ribbon-group">
          <select
            className="nb-style-select"
            value={blockStyle}
            onChange={event => applyBlockStyle(event.target.value)}
            title="Paragraph style"
          >
            <option value="p">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="h4">Heading 4</option>
          </select>
        </div>

        <div className="nb-ribbon-group">
          <Button title="Bold (Ctrl+B)" onClick={() => run('bold')}><b>B</b></Button>
          <Button title="Italic (Ctrl+I)" onClick={() => run('italic')}><i>I</i></Button>
          <Button title="Underline (Ctrl+U)" onClick={() => run('underline')}><u>U</u></Button>
          <Button title="Strikethrough" onClick={() => run('strikeThrough')}><s>S</s></Button>
        </div>

        <div className="nb-ribbon-group">
          <div className="nb-menu-anchor">
            <Button
              title="Highlight"
              onClick={() => setOpenMenu(openMenu === 'highlight' ? null : 'highlight')}
            >
              <span className="nb-swatch-icon" style={{ background: '#fff3a3' }} />
            </Button>
            {openMenu === 'highlight' && (
              <div className="nb-menu">
                {HIGHLIGHTS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="nb-menu-row"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => { run('hiliteColor', value); setOpenMenu(null); }}
                  >
                    <span className="nb-swatch" style={{ background: value }} />{label}
                  </button>
                ))}
                <button
                  type="button"
                  className="nb-menu-row"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => { run('hiliteColor', 'transparent'); setOpenMenu(null); }}
                >
                  <span className="nb-swatch nb-swatch-none" />No highlight
                </button>
              </div>
            )}
          </div>

          <div className="nb-menu-anchor">
            <Button title="Text colour" onClick={() => setOpenMenu(openMenu === 'color' ? null : 'color')}>
              <span className="nb-color-icon">A</span>
            </Button>
            {openMenu === 'color' && (
              <div className="nb-menu">
                {TEXT_COLORS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="nb-menu-row"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => { run('foreColor', value); setOpenMenu(null); }}
                  >
                    <span className="nb-swatch" style={{ background: value }} />{label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="nb-ribbon-group">
          <Button title="Superscript" onClick={() => run('superscript')}>x²</Button>
          <Button title="Subscript" onClick={() => run('subscript')}>x₂</Button>
        </div>

        <div className="nb-ribbon-group">
          <Button title="To-do tag (Ctrl+1)" onClick={toggleTodo}>☑</Button>
          <Button title="Bulleted list" onClick={() => run('insertUnorderedList')}>•</Button>
          <Button title="Numbered list" onClick={() => run('insertOrderedList')}>1.</Button>
          <Button title="Decrease indent" onClick={() => run('outdent')}>⇤</Button>
          <Button title="Increase indent" onClick={() => run('indent')}>⇥</Button>
        </div>

        <div className="nb-ribbon-group">
          <Button title="Align left" onClick={() => run('justifyLeft')}>⇱</Button>
          <Button title="Centre" onClick={() => run('justifyCenter')}>≡</Button>
          <Button title="Align right" onClick={() => run('justifyRight')}>⇲</Button>
        </div>

        <div className="nb-ribbon-group">
          <select
            className="nb-style-select nb-narrow"
            defaultValue=""
            onChange={event => { run('fontName', event.target.value); event.target.value = ''; }}
            title="Font"
          >
            <option value="" disabled>Font</option>
            {FONTS.filter(([value]) => value).map(([value, label]) => (
              <option key={label} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="nb-style-select nb-narrow"
            defaultValue=""
            onChange={event => { run('fontSize', event.target.value); event.target.value = ''; }}
            title="Text size"
          >
            <option value="" disabled>Size</option>
            {SIZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="nb-ribbon-group">
          <Button title="Quote" onClick={() => run('formatBlock', '<blockquote>')}>❝</Button>
          <Button title="Code block" onClick={() => run('formatBlock', '<pre>')}>{'</>'}</Button>
          <Button title="Divider" onClick={() => run('insertHorizontalRule')}>—</Button>
          <div className="nb-menu-anchor">
            <Button
              title="Link"
              active={linkOpen}
              onClick={() => {
                rememberSelection();
                setLinkUrl('https://');
                setLinkOpen(open => !open);
              }}
            >
              🔗
            </Button>
            {linkOpen && (
              <form
                className="nb-link-menu"
                onSubmit={event => {
                  event.preventDefault();
                  const url = linkUrl.trim();
                  if (!url) return;
                  restoreSelection();
                  run('createLink', url);
                  setLinkOpen(false);
                }}
                onMouseDown={event => event.stopPropagation()}
              >
                <label htmlFor="note-link-url">Link address</label>
                <input
                  id="note-link-url"
                  autoFocus
                  value={linkUrl}
                  onChange={event => setLinkUrl(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setLinkOpen(false);
                      restoreSelection();
                    }
                  }}
                  placeholder="https://example.com"
                  inputMode="url"
                />
                <div className="nb-link-actions">
                  <button type="button" onClick={() => { setLinkOpen(false); restoreSelection(); }}>Cancel</button>
                  <button type="submit">Add link</button>
                </div>
              </form>
            )}
          </div>
          <Button title="Remove link" onClick={() => run('unlink')}>⛓</Button>
          <Button
            title="Insert an image"
            onClick={() => {
              const picker = document.createElement('input');
              picker.type = 'file';
              picker.accept = 'image/*';
              picker.onchange = () => { const f = picker.files?.[0]; if (f) void insertImage(f); };
              picker.click();
            }}
          >
            🖼
          </Button>
          <Button title="Clear formatting" onClick={() => run('removeFormat')}>⌫</Button>
        </div>
      </div>

      <div
        ref={editorRef}
        className="nb-canvas"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label="Page content"
        onInput={emit}
        onBlur={emit}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      />
    </div>
  );
}
