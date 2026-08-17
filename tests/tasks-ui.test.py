import json
import os
import re
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("TASKS_E2E_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
STAMP = str(int(time.time() * 1000))
COURSE = f"Task UI Course {STAMP}"
TITLE = f"Task UI Assignment {STAMP}"
UPDATED = f"Task UI Assignment Updated {STAMP}"


def request_json(method: str, path: str, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


course = request_json("POST", "/api/courses", {
    "title": COURSE,
    "semester": "Fall",
    "year": 2026,
})["course"]

task = request_json("POST", "/api/tasks", {
    "title": TITLE,
    "courseId": course["id"],
    "course": COURSE,
    "dueDate": "2026-08-25T22:00:00.000Z",
    "activity": "assignment",
    "estimatedMinutes": 60,
    "priority": 2,
})["task"]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(BASE + "/tasks", wait_until="networkidle")

    expect(page.get_by_text("Task workspace", exact=True)).to_be_visible()
    expect(page.get_by_text(TITLE, exact=True)).to_be_visible()

    page.get_by_text(TITLE, exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    for tab in ["overview", "progress", "sessions", "notes", "schedule", "details"]:
        expect(dialog.get_by_role("button", name=tab, exact=True)).to_be_visible()

    dialog.get_by_role("button", name="details", exact=True).click()
    title_input = dialog.locator('input[type="text"]').first
    expect(title_input).to_have_value(TITLE)
    title_input.fill(UPDATED)
    dialog.get_by_role("button", name="Save changes", exact=True).click()
    expect(dialog.get_by_text(UPDATED, exact=True)).to_be_visible(timeout=10000)

    dialog.get_by_role("button", name="progress", exact=True).click()
    step_input = dialog.get_by_placeholder("Add a step…")
    step_input.fill("Draft issue statement")
    dialog.get_by_role("button", name="Add", exact=True).click()
    expect(dialog.get_by_text("Draft issue statement", exact=True)).to_be_visible(timeout=10000)
    dialog.get_by_text("Draft issue statement", exact=True).locator("xpath=preceding-sibling::input[@type='checkbox']").check()
    expect(dialog.get_by_text("100%", exact=True)).to_be_visible(timeout=10000)

    dialog.get_by_role("button", name="Log partial progress", exact=True).click()
    duration = page.get_by_placeholder("e.g., 45, 1h30m, 1:30")
    expect(duration).to_be_visible()
    duration.fill("20")
    page.get_by_role("button", name="Log Progress", exact=True).click()
    dialog.get_by_role("button", name="overview", exact=True).click()
    expect(dialog.get_by_text("20m", exact=True)).to_be_visible(timeout=10000)

    dialog.get_by_role("button", name="details", exact=True).click()
    dialog.get_by_role("button", name="Move to Trash", exact=True).click()
    expect(dialog).not_to_be_visible(timeout=10000)
    expect(page.get_by_text(UPDATED, exact=True)).not_to_be_visible(timeout=10000)

    trash_button = page.get_by_role("button", name=re.compile(r"^Trash"))
    trash_button.click()
    expect(page.get_by_text(UPDATED, exact=True)).to_be_visible(timeout=10000)
    page.get_by_role("button", name="Restore", exact=True).click()
    expect(page.get_by_text(UPDATED, exact=True)).to_be_visible(timeout=10000)

    workspace = request_json("GET", "/api/tasks/workspace")
    restored = next(item for item in workspace["tasks"] if item["id"] == task["id"])
    assert restored["title"] == UPDATED
    assert restored["workflowState"] == "in-progress"
    assert restored["loggedMinutes"] == 20
    assert restored["checklistPercent"] == 100

    browser.close()
