'use client';

import { useMemo, useState } from 'react';
import { termSortKey } from '@/lib/semester';
import { Notebook, PageSummary, Section, formatUpdated, sectionColor } from './notesTypes';

/**
 * The whole notes hierarchy in one collapsible tree:
 *
 *   Fall 2026
 *     Evidence            (notebook / subject)
 *       Week 1            (section)
 *         Hearsay basics  (page)
 *
 * Every level collapses, and the open/closed state is remembered between
 * visits by the page that owns it.
 */

export type TreeProps = {
  notebooks: Notebook[];
  sections: Section[];
  /** Pages keyed by notebook id, loaded when a notebook is expanded. */
  pagesByNotebook: Record<string, PageSummary[]>;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  selectedNotebookId: string;
  selectedSectionId: string;
  selectedPageId: string;
  loadingNotebookId: string;
  onSelectPage: (notebookId: string, sectionId: string, section: string, pageId: string) => void;
  onNewNotebook: (semester: string) => void;
  onEditNotebook: (notebook: Notebook) => void;
  /** parentId null => a category; a section id => a week inside it. */
  onNewSection: (notebookId: string, parentId: string | null) => void;
  onEditSection: (section: Section, colour: string) => void;
  onNewPage: (notebookId: string, sectionId: string, section: string) => void;
  searchResults: PageSummary[] | null;
  /** Page dragged onto another page (reorder) or onto a section (move). */
  onMovePage: (pageId: string, targetSectionId: string, beforePageId: string | null) => void;
  /** Section dragged onto another section, or onto a notebook to go top level. */
  onMoveSection: (sectionId: string, newParentId: string | null) => void;
};

/** What is currently being dragged. Pages and sections drop differently. */
type Drag = { kind: 'page' | 'section'; id: string } | null;

export const semesterKey = (name: string) => `sem:${name}`;
export const notebookKey = (id: string) => `nb:${id}`;
export const sectionKey = (id: string) => `sec:${id}`;

function Twisty({ open }: { open: boolean }) {
  return <span className={`nb-twisty${open ? ' is-open' : ''}`} aria-hidden="true">▸</span>;
}

export default function NotesTree(props: TreeProps) {
  const {
    notebooks, sections, pagesByNotebook, expanded, onToggle,
    selectedNotebookId, selectedSectionId, selectedPageId, loadingNotebookId,
    onSelectPage, onNewNotebook, onEditNotebook, onNewSection, onEditSection,
    onNewPage, searchResults, onMovePage, onMoveSection,
  } = props;
  const [drag, setDrag] = useState<Drag>(null);
  const [dropId, setDropId] = useState('');
  const clearDrag = () => { setDrag(null); setDropId(''); };

  /** Section ids inside the branch being dragged: it cannot land on itself. */
  const forbidden = useMemo(() => {
    if (drag?.kind !== 'section') return new Set<string>();
    const inside = new Set<string>([drag.id]);
    // Sections arrive parents-first, but loop until it settles so ordering
    // cannot leave a descendant out and wrongly offer it as a target.
    for (let pass = 0; pass < sections.length; pass++) {
      const before = inside.size;
      for (const section of sections) {
        if (section.parentId && inside.has(section.parentId)) inside.add(section.id);
      }
      if (inside.size === before) break;
    }
    return inside;
  }, [drag, sections]);

  const canDropOnSection = (sectionId: string) =>
    !!drag && (drag.kind === 'page' || !forbidden.has(sectionId));

  /** Semester -> notebooks, newest term first. */
  const groups = useMemo(() => {
    const map = new Map<string, Notebook[]>();
    for (const notebook of notebooks) {
      const key = notebook.semester || 'Unsorted';
      map.set(key, [...(map.get(key) || []), notebook]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Unsorted') return 1;
      if (b === 'Unsorted') return -1;
      const diff = termSortKey(b) - termSortKey(a);
      return diff !== 0 ? diff : b.localeCompare(a);
    });
  }, [notebooks]);

  // Search replaces the tree with a flat result list.
  if (searchResults) {
    return (
      <div className="nb-tree">
        <div className="nb-tree-note">
          {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
        </div>
        {searchResults.map(page => (
          <button
            key={page.id}
            type="button"
            className={`nb-node nb-node-page${page.id === selectedPageId ? ' is-active' : ''}`}
            style={{ paddingLeft: 16 }}
            onClick={() => onSelectPage(page.notebookId || '', page.sectionId || '', page.section, page.id)}
          >
            <span className="nb-node-label">{page.pinned ? '★ ' : ''}{page.title}</span>
            <span className="nb-node-meta">{page.notebookName} · {page.section}</span>
          </button>
        ))}
        {searchResults.length === 0 && <p className="nb-tree-empty">Nothing matched that search.</p>}
      </div>
    );
  }

  return (
    <div className="nb-tree">
      {groups.map(([semester, items]) => {
        const semKey = semesterKey(semester);
        const semOpen = expanded.has(semKey);
        return (
          <section key={semester} className="nb-tree-group">
            <div className="nb-node nb-node-sem">
              <button type="button" className="nb-node-main" aria-expanded={semOpen} onClick={() => onToggle(semKey)}>
                <Twisty open={semOpen} />
                <span className="nb-node-label">{semester}</span>
                <span className="nb-node-count">{items.length}</span>
              </button>
              <button
                type="button"
                className="nb-node-action"
                title={`New notebook in ${semester}`}
                onClick={() => onNewNotebook(semester === 'Unsorted' ? '' : semester)}
              >
                +
              </button>
            </div>

            {semOpen && items.map(notebook => {
              const nbKey = notebookKey(notebook.id);
              const nbOpen = expanded.has(nbKey);
              const nbSections = sections.filter(s => s.notebookId === notebook.id);
              const nbPages = pagesByNotebook[notebook.id] || [];

              /**
               * Sections nest, so this walks the tree: a category renders its
               * child weeks, and any section can also hold pages directly.
               */
              const renderSections = (book: Notebook, parentId: string | null, depth: number): React.ReactNode => {
                const level = nbSections.filter(x => (x.parentId || null) === parentId);
                return level.map((section, index) => {
                  const secKey = sectionKey(section.id);
                  const secOpen = expanded.has(secKey);
                  const colour = sectionColor(section, index);
                  const children = nbSections.filter(x => x.parentId === section.id);
                  const secPages = nbPages
                    .filter(p => p.sectionId === section.id)
                    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
                  const isCurrent = section.id === selectedSectionId;
                  const indent = 26 + depth * 20;
                  return (
                    <div key={section.id}>
                      <div
                        className={`nb-node nb-node-sec${isCurrent ? ' is-current' : ''}${dropId === section.id ? ' is-drop-target' : ''}${drag?.kind === 'section' && drag.id === section.id ? ' is-drag' : ''}`}
                        style={{ ['--sec' as any]: colour }}
                        draggable
                        onDragStart={event => {
                          event.stopPropagation();
                          setDrag({ kind: 'section', id: section.id });
                        }}
                        onDragEnd={clearDrag}
                        onDragOver={event => {
                          if (!canDropOnSection(section.id)) return;
                          event.preventDefault();
                          setDropId(section.id);
                        }}
                        onDragLeave={() => setDropId(current => current === section.id ? '' : current)}
                        onDrop={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (canDropOnSection(section.id) && drag) {
                            if (drag.kind === 'page') onMovePage(drag.id, section.id, null);
                            else onMoveSection(drag.id, section.id);
                          }
                          clearDrag();
                        }}
                        title="Drag to file this under another section"
                      >
                        <button type="button" className="nb-node-main" style={{ paddingLeft: indent }} aria-expanded={secOpen} onClick={() => onToggle(secKey)}>
                          <Twisty open={secOpen} />
                          <span className="nb-sec-chip" />
                          <span className="nb-node-label">{section.name}</span>
                          <span className="nb-node-count">{section.pageCount || ''}</span>
                        </button>
                        {depth === 0 && (
                          <button type="button" className="nb-node-action" title={`New week in ${section.name}`} onClick={() => onNewSection(book.id, section.id)}>+</button>
                        )}
                        <button type="button" className="nb-node-action" title={`New page in ${section.name}`} onClick={() => onNewPage(book.id, section.id, section.name)}>✎</button>
                        <button type="button" className="nb-node-action" title={`${section.name} settings`} onClick={() => onEditSection(section, colour)}>⋯</button>
                      </div>

                      {secOpen && (
                        <>
                          {renderSections(book, section.id, depth + 1)}
                          {secPages.map(page => (
                            <button
                              key={page.id}
                              type="button"
                              draggable
                              onDragStart={event => {
                                event.stopPropagation();
                                setDrag({ kind: 'page', id: page.id });
                              }}
                              onDragEnd={clearDrag}
                              onDragOver={event => {
                                if (drag?.kind !== 'page' || drag.id === page.id) return;
                                event.preventDefault();
                                setDropId(page.id);
                              }}
                              onDragLeave={() => setDropId(current => current === page.id ? '' : current)}
                              onDrop={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (drag?.kind === 'page' && drag.id !== page.id) {
                                  onMovePage(drag.id, section.id, page.id);
                                }
                                clearDrag();
                              }}
                              className={`nb-node nb-node-page${page.id === selectedPageId ? ' is-active' : ''}${drag?.kind === 'page' && drag.id === page.id ? ' is-drag' : ''}${dropId === page.id ? ' is-drop-target' : ''}`}
                              style={{ paddingLeft: indent + 22 }}
                              onClick={() => onSelectPage(book.id, section.id, section.name, page.id)}
                            >
                              <span className="nb-node-label">{page.pinned ? '★ ' : ''}{page.title}</span>
                              <span className="nb-node-meta">{formatUpdated(page.updatedAt)}</span>
                            </button>
                          ))}
                          {children.length === 0 && secPages.length === 0 && (
                            <button
                              type="button"
                              className="nb-node nb-node-page nb-node-empty"
                              style={{ paddingLeft: indent + 22 }}
                              onClick={() => onNewPage(book.id, section.id, section.name)}
                            >
                              <span className="nb-node-label">Empty — add a page</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                });
              };

              return (
                <div key={notebook.id}>
                  <div
                    className={`nb-node nb-node-book${notebook.id === selectedNotebookId ? ' is-current' : ''}${dropId === nbKey ? ' is-drop-target' : ''}`}
                    // Dropping a section here lifts it back out to the top
                    // level, which is otherwise unreachable by dragging.
                    onDragOver={event => {
                      if (drag?.kind !== 'section') return;
                      event.preventDefault();
                      setDropId(nbKey);
                    }}
                    onDragLeave={() => setDropId(current => current === nbKey ? '' : current)}
                    onDrop={event => {
                      event.preventDefault();
                      if (drag?.kind === 'section') onMoveSection(drag.id, null);
                      clearDrag();
                    }}
                  >
                    <button type="button" className="nb-node-main" aria-expanded={nbOpen} onClick={() => onToggle(nbKey)}>
                      <Twisty open={nbOpen} />
                      <span className="nb-dot" style={{ background: notebook.color || '#8b5cf6' }} />
                      <span className="nb-node-label">{notebook.name}</span>
                      <span className="nb-node-count">{notebook.noteCount}</span>
                    </button>
                    <button type="button" className="nb-node-action" title={`New category in ${notebook.name}`} onClick={() => onNewSection(notebook.id, null)}>+</button>
                    <button type="button" className="nb-node-action" title={`${notebook.name} settings`} onClick={() => onEditNotebook(notebook)}>⋯</button>
                  </div>

                  {nbOpen && (
                    <>
                      {loadingNotebookId === notebook.id && nbSections.length === 0 && (
                        <p className="nb-tree-empty" style={{ paddingLeft: 34 }}>Loading…</p>
                      )}
                      {renderSections(notebook, null, 0)}
                      {nbSections.filter(x => !x.parentId).length === 0 && loadingNotebookId !== notebook.id && (
                        <button
                          type="button"
                          className="nb-node nb-node-sec nb-node-empty"
                          onClick={() => onNewSection(notebook.id, null)}
                        >
                          <span className="nb-node-label">No categories — add one</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
