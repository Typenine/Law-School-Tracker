import os
import re
import time
import uuid
from datetime import datetime, timezone, timedelta

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get('NOTES_E2E_BASE_URL', 'http://127.0.0.1:3000')
STAMP = uuid.uuid4().hex[:8]
SEMESTER = 'Fall 2099'
MAIN_BOOK = f'UI Evidence {STAMP}'
TARGET_BOOK = f'UI Civil Procedure {STAMP}'
TARGET_PAGE = f'Global Search Target {STAMP}'
TASK_TITLE = f'Reading assignment {STAMP}'


def ok(response):
    assert response.ok, f'{response.status}: {response.text()}'
    return response.json()


def find_note(request, title):
    data = ok(request.get('/api/notes?limit=500'))
    return next(item for item in data['notes'] if item['title'] == title)


def notes_in_notebook(request, notebook_id):
    data = ok(request.get(f'/api/notes?limit=500&notebookId={notebook_id}'))
    return data['notes']


def expand_row(row):
    button = row.locator('button.nb-node-main')
    if button.get_attribute('aria-expanded') != 'true':
        button.click()


def run():
    with sync_playwright() as pw:
        request = pw.request.new_context(base_url=BASE_URL)

        # Seed a second notebook and a task. The first notebook is deliberately
        # created through the UI so its modal, cancellation and save states are
        # exercised rather than bypassed.
        target_book = ok(request.post('/api/notes/notebooks', data={
            'name': TARGET_BOOK,
            'course': TARGET_BOOK,
            'semester': SEMESTER,
            'color': '#2563ec'
        }))['notebook']
        target_sections = ok(request.get(f"/api/notes/sections?notebookId={target_book['id']}"))['sections']
        target_section = target_sections[0]
        ok(request.post('/api/notes', data={
            'title': TARGET_PAGE,
            'notebookId': target_book['id'],
            'section': target_section['name'],
            'sectionId': target_section['id'],
            'contentHtml': '<p>Global target body</p>'
        }))
        task = ok(request.post('/api/tasks', data={
            'title': TASK_TITLE,
            'course': MAIN_BOOK,
            'dueDate': (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            'status': 'todo'
        }))['task']

        browser = pw.chromium.launch()
        page = browser.new_page(base_url=BASE_URL, viewport={'width': 1440, 'height': 1000})
        page.add_init_script("""
          (() => {
            const original = window.fetch.bind(window);
            window.__delayNextNotePatch = false;
            window.fetch = async (input, init = {}) => {
              const response = await original(input, init);
              const url = typeof input === 'string' ? input : input?.url || '';
              const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
              if (window.__delayNextNotePatch && method === 'PATCH' && /\/api\/notes\/[^/?]+/.test(url)) {
                window.__delayNextNotePatch = false;
                await new Promise(resolve => setTimeout(resolve, 1500));
              }
              return response;
            };
          })();
        """)
        page.goto('/notes')
        expect(page.locator('.nb-shell')).to_be_visible(timeout=25_000)

        # Notebook modal opens, cancels, reopens, saves and disappears.
        page.get_by_title('New notebook', exact=True).click()
        modal = page.locator('.nb-modal').filter(has_text='New notebook')
        expect(modal).to_be_visible()
        modal.get_by_role('button', name='Cancel').click()
        expect(modal).to_be_hidden()

        page.get_by_title('New notebook', exact=True).click()
        modal = page.locator('.nb-modal').filter(has_text='New notebook')
        modal.get_by_placeholder('Evidence').fill(MAIN_BOOK)
        modal.locator('select').select_option(SEMESTER)
        modal.get_by_role('button', name='Save', exact=True).click()
        expect(modal).to_be_hidden(timeout=10_000)
        expect(page.locator('.nb-tree')).to_contain_text(MAIN_BOOK)

        main_book = next(item for item in ok(request.get('/api/notes/notebooks'))['notebooks'] if item['name'] == MAIN_BOOK)

        # A new notebook opens its default section with a working page action.
        expect(page.get_by_text('No page open')).to_be_visible(timeout=10_000)
        page.locator('.nb-placeholder').get_by_role('button', name='New page').click()
        title = page.get_by_label('Page title')
        editor = page.get_by_label('Page content')
        expect(title).to_be_visible(timeout=10_000)

        # The prominent app-header controls are the controls a user actually
        # sees first. Add notes must create and open a page; Delete note must be
        # visible, cancellable, and then move that exact page to the trash.
        before_count = len(notes_in_notebook(request, main_book['id']))
        header_add = page.locator('.lst-actions').get_by_role('button', name='Add notes')
        expect(header_add).to_be_visible(timeout=10_000)
        header_add.click()
        for _ in range(100):
            if len(notes_in_notebook(request, main_book['id'])) == before_count + 1:
                break
            time.sleep(.1)
        assert len(notes_in_notebook(request, main_book['id'])) == before_count + 1

        header_title = f'Header Action Audit {STAMP}'
        title.fill(header_title)
        expect(page.get_by_text('All changes saved')).to_be_visible(timeout=10_000)
        header_note = find_note(request, header_title)

        header_delete = page.locator('.lst-actions').get_by_role('button', name='Delete note')
        expect(header_delete).to_be_visible(timeout=10_000)
        header_delete.click()
        confirm = page.get_by_role('alertdialog')
        expect(confirm).to_contain_text('Move to trash?')
        confirm.get_by_role('button', name='Cancel').click()
        expect(title).to_have_value(header_title)

        header_delete.click()
        confirm = page.get_by_role('alertdialog')
        confirm.get_by_role('button', name='Move to trash').click()
        expect(title).not_to_have_value(header_title, timeout=10_000)
        for _ in range(100):
            remaining_ids = {item['id'] for item in notes_in_notebook(request, main_book['id'])}
            if header_note['id'] not in remaining_ids:
                break
            time.sleep(.1)
        assert header_note['id'] not in {item['id'] for item in notes_in_notebook(request, main_book['id'])}

        # Delay the first autosave response, then edit again while it is still
        # in flight. The status must not claim the second edit was saved until a
        # second PATCH actually persists it.
        page.evaluate('window.__delayNextNotePatch = true')
        title.fill(f'Autosave Audit {STAMP}')
        editor.fill('Version one')
        page.wait_for_timeout(1050)
        editor.fill('Version two final')
        expect(page.get_by_text('All changes saved')).to_be_visible(timeout=12_000)

        saved = find_note(request, f'Autosave Audit {STAMP}')
        full = ok(request.get(f"/api/notes/{saved['id']}"))['note']
        assert full['content'] == 'Version two final', full

        # Page info appears and disappears, and every exposed field persists.
        info_button = page.get_by_role('button', name='Page info')
        info_button.click()
        details = page.locator('.nb-details')
        expect(details).to_be_visible()
        assignment_select = details.locator('label').filter(has_text='For assignment').locator('select')
        assignment_select.select_option(str(task['id']))
        details.get_by_placeholder('hearsay, exam, professor emphasis').fill('evidence, audit')
        page.get_by_role('button', name=re.compile(r'Pin$')).click()
        expect(page.get_by_text('All changes saved')).to_be_visible(timeout=10_000)

        full = ok(request.get(f"/api/notes/{saved['id']}"))['note']
        assert str(full['taskId']) == str(task['id']), full
        assert full['pinned'] is True, full
        assert full['topics'] == ['evidence', 'audit'], full

        info_button.click()
        expect(details).to_be_hidden()

        # Export waits for pending saves and produces a real download.
        title.fill(f'Exported Audit {STAMP}')
        with page.expect_download(timeout=10_000) as download_info:
            page.get_by_role('button', name='Export page').click()
        assert download_info.value.suggested_filename.endswith('.md')

        # Link no longer relies on a browser prompt. It has a cancellable,
        # visible input and restores the selected range when applied.
        editor.click()
        page.keyboard.press('Control+A')
        page.get_by_title('Link', exact=True).click()
        link_form = page.locator('.nb-link-menu')
        expect(link_form).to_be_visible()
        link_form.get_by_role('button', name='Cancel').click()
        expect(link_form).to_be_hidden()
        editor.click()
        page.keyboard.press('Control+A')
        page.get_by_title('Link', exact=True).click()
        link_form.locator('input').fill('https://example.com/audit')
        link_form.get_by_role('button', name='Add link').click()
        expect(editor.locator('a[href="https://example.com/audit"]')).to_be_visible()
        expect(page.get_by_text('All changes saved')).to_be_visible(timeout=10_000)

        # Pages/Focus and the reopen tab show and hide the list predictably.
        page.get_by_role('button', name=re.compile(r'^Pages')).click()
        pages_panel = page.locator('.nb-pages')
        expect(pages_panel).to_be_visible()
        page.get_by_role('button', name=re.compile(r'^Focus')).click()
        expect(pages_panel).to_be_hidden()
        page.get_by_role('button', name='‹ Pages').click()
        expect(pages_panel).to_be_visible()

        # Search is global. Choosing a result from another notebook must update
        # the breadcrumbs and current page instead of leaving stale context.
        panel_search = pages_panel.get_by_label('Search all notes')
        panel_search.fill(TARGET_PAGE)
        result = pages_panel.locator('.nb-page-item').filter(has_text=TARGET_PAGE)
        expect(result).to_be_visible(timeout=10_000)
        result.click()
        expect(page.locator('.nb-crumbs')).to_contain_text(TARGET_BOOK)
        expect(page.get_by_label('Page title')).to_have_value(TARGET_PAGE)
        panel_search.fill('')

        # File import closes its modal, opens the imported page and stores the
        # section id returned by the server.
        pages_panel.get_by_role('button', name='Import a file').click()
        import_modal = page.locator('.nb-modal').filter(has_text=f'Import into {TARGET_BOOK}')
        expect(import_modal).to_be_visible()
        import_modal.locator('input[type=file]').set_input_files({
            'name': 'audit.txt',
            'mimeType': 'text/plain',
            'buffer': b'Imported content survives'
        })
        import_modal.get_by_placeholder('Uses the file name when blank').fill(f'Imported Audit {STAMP}')
        import_modal.get_by_role('button', name='Import as page').click()
        expect(import_modal).to_be_hidden(timeout=12_000)
        expect(page.get_by_label('Page title')).to_have_value(f'Imported Audit {STAMP}')
        imported = find_note(request, f'Imported Audit {STAMP}')
        assert imported['sectionId'] == target_section['id'], imported

        # Archive confirmation can be cancelled. Confirming removes the page,
        # Set aside shows it, and Restore closes the modal and reopens the page.
        page.get_by_role('button', name='Page info').click()
        page.get_by_role('button', name='Archive page').click()
        confirm = page.get_by_role('alertdialog')
        expect(confirm).to_contain_text('Archive this page?')
        confirm.get_by_role('button', name='Cancel').click()
        expect(page.get_by_label('Page title')).to_have_value(f'Imported Audit {STAMP}')
        page.get_by_role('button', name='Archive page').click()
        page.get_by_role('alertdialog').get_by_role('button', name='Archive').click()
        expect(page.get_by_label('Page title')).to_be_hidden(timeout=10_000)
        page.get_by_role('button', name=re.compile(r'^Set aside')).click()
        aside = page.locator('.nb-modal').filter(has_text='Set aside')
        row = aside.locator('.nb-aside-row').filter(has_text=f'Imported Audit {STAMP}')
        expect(row).to_be_visible()
        row.get_by_role('button', name='Restore').click()
        expect(aside).to_be_hidden(timeout=10_000)
        expect(page.get_by_label('Page title')).to_have_value(f'Imported Audit {STAMP}')

        # A same-page conflict must replace the uncontrolled editor when the
        # user chooses the server version.
        current = ok(request.get(f"/api/notes/{imported['id']}"))['note']
        ok(request.patch(f"/api/notes/{imported['id']}", data={
            'contentHtml': '<p>Server version wins</p>',
            'expectedUpdatedAt': current['updatedAt']
        }))
        editor = page.get_by_label('Page content')
        editor.fill('My unsaved local version')
        conflict = page.get_by_role('alertdialog')
        expect(conflict).to_contain_text('This page changed somewhere else', timeout=10_000)
        conflict.get_by_role('button', name='Discard mine').click()
        expect(conflict).to_be_hidden(timeout=10_000)
        expect(editor).to_contain_text('Server version wins')

        # Rail visibility and a section modal cancel are also reversible.
        rail = page.locator('.nb-rail')
        page.get_by_title('Hide the notebook tree').click()
        expect(rail).to_be_hidden()
        page.get_by_title('Show the notebook tree').click()
        expect(rail).to_be_visible()

        # Expand the target branch and verify the section settings dialog can
        # be opened and dismissed without changing anything.
        sem_row = page.locator('.nb-node-sem').filter(has_text=SEMESTER).first
        expand_row(sem_row)
        book_row = page.locator('.nb-node-book').filter(has_text=TARGET_BOOK).first
        expand_row(book_row)
        book_container = book_row.locator('xpath=..')
        book_container.get_by_title('Notes settings').click()
        section_modal = page.locator('.nb-modal').filter(has_text='Section settings')
        expect(section_modal).to_be_visible()
        section_modal.get_by_role('button', name='Cancel').click()
        expect(section_modal).to_be_hidden()

        browser.close()
        request.dispose()


if __name__ == '__main__':
    run()
