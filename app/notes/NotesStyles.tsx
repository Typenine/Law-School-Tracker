'use client';

/**
 * Styles for the notes workspace, kept out of the page component so the markup
 * stays readable. The layout follows OneNote: notebook rail, coloured section
 * tabs across the top, the page canvas in the middle and the page list on the
 * right, with the active section's colour running through the chrome.
 */
export default function NotesStyles() {
  return (
    <style jsx global>{`
      /* The app shell caps page content at ~1180px. The notes workspace is a
         full-bleed editor, so it opts out and uses the whole window. */
      body[data-route='/notes'] .lst-content > * { max-width: none !important; }
      body[data-route='/notes'] .lst-content { padding: 16px 20px 20px !important; }
      .nb-shell, .nb-empty-state, .nb-boot { max-width: 100% !important; width: 100%; }
      .nb-boot { display: grid; place-items: center; min-height: 60vh; color: var(--muted); }

      .nb-empty-state { display: grid; place-items: center; min-height: 62vh; }
      .nb-empty-card { max-width: 520px; padding: 34px; border: 1px solid var(--line); border-radius: 14px; background: var(--s1); text-align: center; }
      .nb-empty-card h2 { margin: 0 0 12px; font-size: 22px; }
      .nb-empty-card p { margin: 0 0 22px; color: var(--muted); line-height: 1.6; }

      .nb-error { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 10px 14px; border: 1px solid rgba(224,122,104,.45); border-radius: 9px; background: rgba(201,85,61,.14); color: #f0c4bb; font-size: 13px; }
      .nb-error button { background: none; border: 0; color: inherit; font-size: 17px; cursor: pointer; }

      /* Frame ------------------------------------------------------------ */
      .nb-frame { --tab: #8b5cf6; display: grid; grid-template-columns: 264px minmax(0, 1fr); height: calc(100vh - 118px); min-height: 620px; border: 1px solid var(--line); border-radius: 12px; background: var(--s1); overflow: hidden; }
      .nb-rail-collapsed .nb-frame { grid-template-columns: 0 minmax(0, 1fr); }
      .nb-rail-collapsed .nb-rail { display: none; }

      /* Notebook rail ---------------------------------------------------- */
      .nb-rail { display: flex; flex-direction: column; min-width: 0; background: var(--side); border-right: 1px solid var(--line); }
      .nb-rail-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 12px 10px; color: var(--label); font: 500 10px/1 'IBM Plex Mono', monospace; letter-spacing: .12em; text-transform: uppercase; }
      .nb-icon-button { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid var(--btn); border-radius: 5px; background: var(--s2); color: var(--text2); cursor: pointer; }
      .nb-icon-button:hover { background: var(--hover); }
      .nb-rail-scroll { flex: 1; overflow-y: auto; padding: 0 6px 14px; }
      .nb-rail-search { padding: 0 10px 10px; }
      .nb-rail-search input { width: 100%; padding: 6px 9px !important; font-size: 12px; }

      /* Collapsible tree: semester > subject > week > page */
      .nb-tree { display: flex; flex-direction: column; gap: 1px; }
      .nb-tree-group { margin-bottom: 5px; }
      .nb-tree-note, .nb-tree-empty { padding: 7px 10px; color: var(--muted2); font-size: 11.5px; }
      .nb-node { display: flex; align-items: center; border-radius: 6px; }
      .nb-node:hover { background: var(--s3); }
      .nb-node-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 6px 4px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .nb-node-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nb-node-count { color: var(--muted2); font: 400 10px/1 'IBM Plex Mono', monospace; }
      .nb-node-meta { color: var(--muted2); font: 400 10px/1 'IBM Plex Mono', monospace; padding-left: 6px; }
      .nb-node-action { padding: 3px 6px; border: 0; background: none; color: var(--muted2); font-size: 12px; cursor: pointer; opacity: 0; border-radius: 4px; }
      .nb-node:hover .nb-node-action, .nb-node-action:focus { opacity: 1; }
      .nb-node-action:hover { background: var(--hover); color: var(--text); }
      .nb-twisty { flex: 0 0 11px; color: var(--muted2); font-size: 9px; transition: transform .12s; }
      .nb-twisty.is-open { transform: rotate(90deg); }

      .nb-node-sem > .nb-node-main { color: var(--text2); font: 500 10.5px/1.2 'IBM Plex Mono', monospace; letter-spacing: .1em; text-transform: uppercase; }
      .nb-node-book > .nb-node-main { padding-left: 14px; color: var(--text3); font-size: 12.5px; }
      .nb-node-book.is-current > .nb-node-main { color: var(--text); font-weight: 500; }
      .nb-node-sec > .nb-node-main { padding-left: 28px; color: var(--text3); font-size: 12px; }
      .nb-node-sec.is-current { background: var(--active); }
      .nb-node-sec.is-current > .nb-node-main { color: var(--text); }
      .nb-sec-chip { flex: 0 0 3px; width: 3px; height: 12px; border-radius: 2px; background: var(--sec, var(--muted2)); }
      .nb-node-page { width: 100%; padding: 5px 8px 5px 46px; border: 0; background: none; color: var(--muted); font-size: 12px; text-align: left; cursor: pointer; display: flex; align-items: center; }
      .nb-node-page:hover { background: var(--s3); color: var(--text2); }
      .nb-node-page.is-active { background: var(--active); color: var(--text); box-shadow: inset 2px 0 var(--tab); }
      .nb-node-empty { font-style: italic; opacity: .6; }

      .nb-rail-filter { margin: 0 8px 8px; padding: 9px 10px; border: 1px solid var(--accent-line, var(--line2)); border-radius: 8px; background: var(--s2); display: grid; gap: 7px; }
      .nb-rail-filter-label { display: block; color: var(--label); font: 500 10px/1 'IBM Plex Mono', monospace; letter-spacing: .1em; text-transform: uppercase; padding-bottom: 4px; }
      .nb-rail-filter strong { font-size: 12.5px; font-weight: 500; }
      .nb-rail-filter-actions { display: flex; gap: 6px; }
      .nb-rail-filter-actions button { flex: 1; padding: 5px 8px; border: 1px solid var(--line2); border-radius: 6px; background: var(--s3); color: var(--text2); font-size: 11px; cursor: pointer; }
      .nb-rail-filter-actions button:hover { color: var(--text); background: var(--s1); }
      .nb-rail-foot-row { display: grid; gap: 6px; }
      .nb-rail-foot { margin: 0 8px 10px; padding: 8px; border: 1px solid var(--line2); border-radius: 7px; background: var(--s2); color: var(--muted); font-size: 11.5px; cursor: pointer; }
      .nb-rail-foot-row .nb-rail-foot { margin-bottom: 0; }
      .nb-rail-foot-row { margin-bottom: 10px; }
      .nb-rail-foot:hover { background: var(--s3); color: var(--text2); }
      .nb-aside-list { display: grid; gap: 16px; max-height: 58vh; overflow-y: auto; }
      .nb-conflict { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media (max-width: 760px) { .nb-conflict { grid-template-columns: 1fr; } }
      .nb-conflict-body { max-height: 42vh; overflow: auto; padding: 10px 12px; border: 1px solid var(--line2); border-radius: 8px; background: var(--s2); font-size: 13px; line-height: 1.55; }
      .nb-conflict-body :is(h1,h2,h3) { font-size: 15px; margin: 8px 0 4px; }
      .nb-conflict-body img { max-width: 100%; height: auto; }
      .nb-aside-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--label); font: 500 10px/1 'IBM Plex Mono', monospace; letter-spacing: .1em; text-transform: uppercase; padding-bottom: 7px; }
      .nb-aside-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
      .nb-aside-main { flex: 1; min-width: 0; display: grid; }
      .nb-conflict { border-color: rgba(255,204,0,.5) !important; background: rgba(255,204,0,.1) !important; color: #ffe8a3 !important; }

      /* Drag feedback in the tree */
      .nb-node-page.is-drag { opacity: .45; }
      .nb-node.is-drop-target { outline: 1px dashed var(--tab); outline-offset: -1px; }

      /* Breadcrumb replaces the old horizontal tab strip */
      .nb-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding-bottom: 7px; overflow: hidden; }
      .nb-crumb { color: var(--text2); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .nb-crumb-sep { color: var(--muted2); }
      .nb-rail-group { padding: 12px 6px 5px; color: var(--muted2); font: 500 9.5px/1 'IBM Plex Mono', monospace; letter-spacing: .11em; text-transform: uppercase; }
      .nb-rail-row { display: flex; align-items: center; border-radius: 7px; }
      .nb-rail-row:hover { background: var(--s3); }
      .nb-rail-row.is-active { background: var(--active); box-shadow: inset 2px 0 var(--tab); }
      .nb-rail-item { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; padding: 8px 6px 8px 10px; border: 0; background: none; color: var(--text3); font: inherit; text-align: left; cursor: pointer; }
      .nb-rail-row.is-active .nb-rail-item { color: var(--text); }
      .nb-dot { flex: 0 0 9px; width: 9px; height: 9px; border-radius: 50%; }
      .nb-rail-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nb-rail-count { color: var(--muted2); font: 400 10.5px/1 'IBM Plex Mono', monospace; }
      .nb-rail-edit { padding: 4px 8px; border: 0; background: none; color: var(--muted2); cursor: pointer; opacity: 0; }
      .nb-rail-row:hover .nb-rail-edit, .nb-rail-edit:focus { opacity: 1; }

      /* Section tabs ----------------------------------------------------- */
      .nb-body { display: flex; flex-direction: column; min-width: 0; }
      .nb-tabbar { display: flex; align-items: center; gap: 10px; padding: 9px 14px 0; background: var(--side); border-bottom: 2px solid var(--tab); }
      .nb-rail-toggle { margin-bottom: 7px; flex: 0 0 auto; width: 28px; height: 28px; border: 1px solid var(--btn); border-radius: 6px; background: var(--s2); color: var(--text3); cursor: pointer; }
      .nb-rail-toggle:hover { background: var(--hover); }
      .nb-tabs { flex: 1; min-width: 0; display: flex; align-items: flex-end; gap: 3px; overflow-x: auto; scrollbar-width: thin; }
      .nb-tab { position: relative; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; max-width: 210px; padding: 8px 14px; border: 1px solid var(--line2); border-bottom: 0; border-radius: 7px 7px 0 0; background: var(--s2); color: var(--text3); font-size: 12.5px; cursor: pointer; }
      .nb-tab:before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px; border-radius: 7px 7px 0 0; background: var(--tab-color, var(--muted2)); }
      .nb-tab:hover { background: var(--s3); color: var(--text); }
      .nb-tab.is-active { background: var(--s1); color: var(--text); border-color: var(--tab); padding-bottom: 10px; margin-bottom: -2px; font-weight: 500; }
      .nb-tab-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nb-tab-count { color: var(--muted2); font: 400 10px/1 'IBM Plex Mono', monospace; }
      .nb-tab-add { padding-inline: 12px; font-size: 15px; }
      .nb-tab-add:before { background: transparent; }
      .nb-tab-settings { margin-bottom: 7px; flex: 0 0 auto; padding: 6px 11px; border: 1px solid var(--btn); border-radius: 6px; background: var(--s2); color: var(--text3); font-size: 11.5px; cursor: pointer; white-space: nowrap; }
      .nb-tab-settings:hover { background: var(--hover); color: var(--text); }

      /* Workspace -------------------------------------------------------- */
      .nb-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 268px; }
      .nb-pages-collapsed .nb-workspace { grid-template-columns: minmax(0, 1fr); }
      .nb-pages-collapsed .nb-pages { display: none; }
      .nb-canvas-column { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--s1); }
      .nb-placeholder { display: grid; place-content: center; justify-items: center; gap: 9px; height: 100%; padding: 40px; color: var(--muted); text-align: center; }
      .nb-placeholder h3 { margin: 0; color: var(--text2); }
      .nb-placeholder p { margin: 0; }

      .nb-page-head { padding: 20px 30px 12px; border-bottom: 1px solid var(--line); }
      .nb-page-title { width: 100%; padding: 2px 0 6px !important; border: 0 !important; border-bottom: 1px solid transparent !important; border-radius: 0 !important; background: transparent !important; color: var(--text) !important; font: 500 26px/1.25 'Newsreader', Georgia, serif !important; }
      .nb-page-title:focus { border-bottom-color: var(--tab) !important; background: transparent !important; }
      .nb-page-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 8px; color: var(--muted2); font-size: 11.5px; }
      .nb-sep { opacity: .5; }
      .nb-save.is-dirty { color: var(--gold); }
      .nb-save-saving { color: var(--blue2); }
      .nb-save-error { color: var(--red2); }
      .nb-page-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
      .nb-chip { padding: 5px 11px; border: 1px solid var(--btn); border-radius: 999px; background: var(--s2); color: var(--text3); font-size: 11.5px; cursor: pointer; }
      .nb-chip:hover { background: var(--hover); color: var(--text); }
      .nb-chip.is-on { border-color: var(--gold); color: var(--gold); }

      .nb-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 14px 30px; border-bottom: 1px solid var(--line); background: var(--s2); }
      .nb-details label { display: flex; flex-direction: column; gap: 5px; }
      .nb-details label > span { color: var(--label) !important; font-size: 10px !important; letter-spacing: .08em; text-transform: uppercase; }
      .nb-details-wide { grid-column: 1 / -1; }
      .nb-details-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 16px; }

      /* Ribbon ----------------------------------------------------------- */
      .nb-editor-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .nb-ribbon { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 7px 30px; border-bottom: 1px solid var(--line); background: var(--s2); }
      .nb-ribbon-group { display: flex; align-items: center; gap: 2px; padding-right: 8px; margin-right: 4px; border-right: 1px solid var(--line2); }
      .nb-ribbon-group:last-child { border-right: 0; }
      .nb-tool { min-width: 29px; height: 29px; padding: 0 7px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--text3); font-size: 13px; cursor: pointer; }
      .nb-tool:hover { border-color: var(--btn); background: var(--s3); color: var(--text); }
      .nb-tool.is-active { border-color: var(--tab); color: var(--text); }
      .nb-style-select { height: 29px; min-width: 116px; padding: 0 8px !important; border: 1px solid var(--input) !important; border-radius: 6px !important; background: var(--s1) !important; color: var(--text2) !important; font-size: 12px; }
      .nb-style-select.nb-narrow { min-width: 74px; }
      .nb-swatch-icon { width: 15px; height: 15px; border: 1px solid rgba(0,0,0,.3); border-radius: 3px; }
      .nb-color-icon { font-weight: 600; border-bottom: 3px solid var(--tab); line-height: 1.1; }
      .nb-menu-anchor { position: relative; }
      .nb-menu { position: absolute; z-index: 20; top: 34px; left: 0; min-width: 168px; padding: 5px; border: 1px solid var(--line2); border-radius: 8px; background: #0b1727; box-shadow: 0 18px 42px rgba(0,0,0,.55); }
      .nb-menu-row { width: 100%; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; border-radius: 6px; background: none; color: var(--text2); font-size: 12.5px; text-align: left; cursor: pointer; }
      .nb-menu-row:hover { background: var(--s3); }
      .nb-swatch { width: 14px; height: 14px; border: 1px solid rgba(0,0,0,.35); border-radius: 3px; }
      .nb-swatch-none { background: repeating-linear-gradient(45deg, #444 0 3px, #222 3px 6px); }

      /* Canvas ----------------------------------------------------------- */
      .nb-canvas { flex: 1; min-height: 0; overflow-y: auto; padding: 26px 34px 160px; outline: none; color: var(--text); font: 15.5px/1.75 'IBM Plex Sans', system-ui, sans-serif; }
      .nb-canvas pre { margin: 0 0 12px; padding: 10px 13px; border-radius: 7px; background: var(--s3); font-family: 'IBM Plex Mono', monospace; font-size: 13px; white-space: pre-wrap; }
      .nb-canvas:empty:before { content: 'Start typing…'; color: var(--muted2); }
      .nb-canvas p { margin: 0 0 11px; }
      .nb-canvas h1, .nb-canvas h2, .nb-canvas h3, .nb-canvas h4 { margin: 22px 0 9px; font-family: 'Newsreader', Georgia, serif !important; line-height: 1.25; }
      .nb-canvas h1 { font-size: 26px; }
      .nb-canvas h2 { font-size: 21px; }
      .nb-canvas h3 { font-size: 17.5px; }
      .nb-canvas h4 { font-size: 15.5px; }
      .nb-canvas ul, .nb-canvas ol { margin: 0 0 12px; padding-left: 26px; }
      .nb-canvas li { margin-bottom: 4px; }
      .nb-canvas blockquote { margin: 0 0 12px; padding: 4px 0 4px 15px; border-left: 3px solid var(--tab); color: var(--text2); }
      .nb-canvas hr { margin: 20px 0; border: 0; border-top: 1px solid var(--line2); }
      .nb-canvas a { color: var(--blue2); }
      .nb-canvas img { max-width: 100%; height: auto; margin: 8px 0; border-radius: 6px; border: 1px solid var(--line2); }
      .nb-canvas code { padding: 1px 5px; border-radius: 4px; background: var(--s3); font-size: 13px; }
      .nb-canvas ::selection { background: rgba(139,92,246,.4); }

      /* To-do tags */
      .nb-canvas ul.nb-todo-list { padding-left: 6px; list-style: none; }
      .nb-canvas li.nb-todo { position: relative; padding-left: 27px; list-style: none; }
      .nb-canvas li.nb-todo:before { content: ''; position: absolute; left: 2px; top: .35em; width: 15px; height: 15px; border: 1.5px solid var(--muted); border-radius: 3px; background: transparent; cursor: pointer; }
      .nb-canvas li.nb-todo[data-checked='true']:before { border-color: var(--green2); background: var(--green2); }
      .nb-canvas li.nb-todo[data-checked='true']:after { content: '✓'; position: absolute; left: 5px; top: .3em; color: #06152b; font-size: 11px; font-weight: 700; pointer-events: none; }
      .nb-canvas li.nb-todo[data-checked='true'] { color: var(--muted); text-decoration: line-through; }

      /* Page list -------------------------------------------------------- */
      .nb-pages { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); background: var(--s2); }
      .nb-pages-head { display: grid; gap: 7px; padding: 12px; border-bottom: 1px solid var(--line); }
      .nb-pages-title { display: flex; align-items: center; justify-content: space-between; color: var(--label); font: 500 10px/1 'IBM Plex Mono', monospace; letter-spacing: .12em; text-transform: uppercase; }
      .nb-collapse { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid var(--btn); border-radius: 5px; background: var(--s1); color: var(--text3); font-size: 13px; cursor: pointer; }
      .nb-collapse:hover { background: var(--hover); color: var(--text); }
      /* Slim tab that brings the collapsed page list back. */
      .nb-pages-reopen { position: absolute; top: 12px; right: 0; z-index: 5; padding: 7px 9px; border: 1px solid var(--line2); border-right: 0; border-radius: 7px 0 0 7px; background: var(--s2); color: var(--text3); font-size: 11.5px; cursor: pointer; }
      .nb-pages-reopen:hover { background: var(--s3); color: var(--text); }
      .nb-workspace { position: relative; }
      .nb-block { width: 100%; }
      .nb-search { width: 100%; padding: 7px 10px !important; font-size: 12.5px; }
      .nb-pages-list { flex: 1; overflow-y: auto; }
      .nb-pages-note { padding: 9px 13px; color: var(--muted2); font-size: 11px; }
      .nb-pages-empty { padding: 20px 14px; color: var(--muted2); font-size: 12.5px; }
      .nb-page-item { position: relative; display: grid; gap: 3px; width: 100%; padding: 11px 13px 12px 16px; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; cursor: pointer; }
      .nb-page-item:hover { background: var(--s3); }
      .nb-page-item.is-active { background: var(--s1); box-shadow: inset 3px 0 var(--tab); }
      .nb-page-item.is-dragging { opacity: .45; }
      .nb-page-item-title { color: var(--text2); font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nb-page-item.is-active .nb-page-item-title { color: var(--text); }
      .nb-page-item-meta { color: var(--muted2); font: 400 10.5px/1.3 'IBM Plex Mono', monospace; }
      .nb-page-item-preview { color: var(--muted); font-size: 11.5px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

      /* Buttons and modals ----------------------------------------------- */
      .nb-primary { padding: 8px 15px; border: 1px solid var(--gold); border-radius: 7px; background: var(--gold); color: var(--ink); font-size: 12.5px; font-weight: 600; cursor: pointer; }
      .nb-primary:hover { background: var(--gold2); }
      .nb-primary:disabled { opacity: .55; cursor: default; }
      .nb-secondary { padding: 8px 15px; border: 1px solid var(--btn); border-radius: 7px; background: var(--s1); color: var(--text2); font-size: 12.5px; cursor: pointer; }
      .nb-secondary:hover { background: var(--hover); color: var(--text); }
      .nb-link-danger, .nb-link-warn { border: 0; background: none; font-size: 12.5px; cursor: pointer; }
      .nb-link-danger { color: var(--red2); }
      .nb-link-warn { color: var(--gold); }
      .nb-link-danger:hover, .nb-link-warn:hover { text-decoration: underline; }

      .nb-modal-scrim { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: rgba(3,10,20,.72); backdrop-filter: blur(2px); }
      .nb-modal { width: 100%; max-width: 430px; display: grid; gap: 15px; padding: 22px; border: 1px solid var(--line2); border-radius: 13px; background: #0b1727; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
      .nb-modal-wide { max-width: 580px; }
      .nb-modal-head { display: flex; justify-content: space-between; gap: 14px; }
      .nb-modal-head h3 { margin: 0; font-size: 17px; }
      .nb-modal-head p { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
      .nb-modal-head button { border: 0; background: none; color: var(--muted); font-size: 21px; line-height: 1; cursor: pointer; }
      .nb-field { display: flex; flex-direction: column; gap: 6px; }
      .nb-field > span { color: var(--label) !important; font-size: 10px !important; letter-spacing: .08em; text-transform: uppercase; }
      .nb-field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
      .nb-color-row { display: flex; flex-wrap: wrap; gap: 7px; }
      .nb-color-dot { width: 25px; height: 25px; border: 2px solid transparent; border-radius: 50%; cursor: pointer; }
      .nb-color-dot.is-on { border-color: var(--text); }
      .nb-modal-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .nb-modal-foot > div { display: flex; gap: 8px; }

      @media (max-width: 1080px) {
        .nb-workspace { grid-template-columns: minmax(0, 1fr) 232px; }
        .nb-frame { grid-template-columns: 230px minmax(0, 1fr); }
        .nb-page-head, .nb-ribbon, .nb-canvas, .nb-details { padding-inline: 18px; }
      }
      @media (max-width: 860px) {
        /* Stack everything and turn the notebook rail into a scrollable strip
           so notebooks stay reachable on a phone. */
        .nb-frame, .nb-rail-collapsed .nb-frame { grid-template-columns: minmax(0, 1fr); height: auto; }
        .nb-rail, .nb-rail-collapsed .nb-rail { display: block; border-right: 0; border-bottom: 1px solid var(--line); }
        .nb-rail-head { display: none; }
        .nb-rail-scroll { display: flex; gap: 7px; padding: 10px; overflow-x: auto; }
        .nb-rail-scroll > section { display: flex; align-items: center; gap: 7px; }
        .nb-rail-group { padding: 0 4px 0 0; }
        .nb-rail-row { flex: 0 0 auto; border: 1px solid var(--line2); }
        .nb-rail-name { max-width: 130px; }
        .nb-rail-edit { opacity: 1; }
        .nb-workspace { grid-template-columns: minmax(0, 1fr); }
        .nb-canvas { min-height: 340px; }
        .nb-pages { border-left: 0; border-top: 1px solid var(--line); max-height: 340px; }
        .nb-rail-toggle { display: none; }
        .nb-page-head, .nb-ribbon, .nb-canvas, .nb-details { padding-inline: 14px; }
      }
    `}</style>
  );
}
