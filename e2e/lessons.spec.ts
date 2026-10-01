import { expect, test, type Page } from '@playwright/test';

/**
 * The Lessons tab of the Playbook.
 *
 * A lesson is the trader's own documented finding, with screenshots and short clips. These
 * tests cover the parts a trader actually relies on: writing one down, filing it under a kind
 * and a tag, finding it again by search or filter, editing it in place, and having it survive a
 * reload — plus the dedicated coach card that reads the library on request.
 */

/** A one-pixel PNG, enough to prove an attachment is compressed, stored and read back. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function gotoLessons(page: Page) {
  const desktop = page.locator('#nav-btn-playbook');
  const mobile = page.locator('#mobile-nav-playbook');
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await page.locator('#playbook-tab-lessons').click();
  await expect(
    page.getByRole('heading', { name: /Trading Setups & Playbook Library/i })
  ).toBeVisible();
}

/** Fills the lesson form and saves it. */
async function addLesson(
  page: Page,
  fields: { title: string; notes?: string; kind: string; tags?: string }
) {
  await page.locator('#lesson-add').click();
  await page.locator('#lesson-title').fill(fields.title);
  if (fields.notes) await page.locator('#lesson-notes').fill(fields.notes);
  await page.locator('#lesson-kind').selectOption(fields.kind);
  if (fields.tags) await page.locator('#lesson-tags').fill(fields.tags);
  await page.locator('#lesson-save').click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ptj_lessons_e2e_cleared')) return;
    sessionStorage.setItem('ptj_lessons_e2e_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test('writes, files, finds, edits and keeps a lesson', async ({ page }) => {
  await gotoLessons(page);

  // The empty state explains itself before anything is saved.
  await expect(page.getByText('No lessons saved yet')).toBeVisible();

  // The coach card is present and has nothing to read yet.
  const coachCard = page.locator('#playbook-coach-lessons');
  await expect(coachCard).toBeVisible();
  await expect(coachCard.getByText(/Nothing written down yet/i)).toBeVisible();

  // Write the first lesson.
  await addLesson(page, {
    title: 'Overnight high gets swept before the open reverses',
    notes: 'The sweep takes the pre-open stops, then the move fades back inside the range.',
    kind: 'mistake',
    tags: 'liquidity, pre-open',
  });

  const rows = page.locator('[data-lesson-row]');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Overnight high gets swept before the open reverses');
  await expect(rows).toContainText('Mistake');
  await expect(rows).toContainText('liquidity');

  // The coach card now counts it and offers the read.
  await expect(coachCard.locator('#coach-lessons-facts')).toContainText('Lessons saved');
  await expect(page.locator('#coach-lessons-generate')).toBeVisible();

  // A second lesson of a different kind, so the kind filter has something to separate.
  await addLesson(page, {
    title: 'Range compresses before the open drive',
    kind: 'pattern',
  });
  await expect(rows).toHaveCount(2);

  // Search narrows the list without deleting anything.
  await page.locator('#lesson-search').fill('nothing matches this');
  await expect(page.getByText('No lesson matches that search or filter.')).toBeVisible();
  await page.locator('#lesson-search').fill('pre-open');
  await expect(rows).toHaveCount(1);
  await page.locator('#lesson-search').fill('');

  // Filtering by kind narrows to that kind.
  await page.locator('#lesson-filter-pattern').click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Range compresses before the open drive');
  await page.locator('#lesson-filter-mistake').click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Overnight high gets swept');

  // Clear the filter so the whole library is back on screen for the edit below.
  await page.locator('#lesson-filter-all').click();
  await expect(rows).toHaveCount(2);

  // Edit in place: the row keeps its identity, the text changes and it stays one record.
  const lessonId = await page
    .locator('[data-lesson-row]', { hasText: 'Overnight high gets swept' })
    .getAttribute('data-lesson-row');
  await page.locator(`#lesson-edit-${lessonId}`).click();
  await page.locator('#lesson-title').fill('Pre-open sweep fades back inside the range');
  await page.locator('#lesson-save').click();
  await expect(page.locator(`[data-lesson-row="${lessonId}"]`)).toContainText(
    'Pre-open sweep fades back inside the range'
  );
  await expect(rows).toHaveCount(2);

  // Reload: both lessons are still there, with their tags.
  await page.reload();
  await gotoLessons(page);
  await expect(rows).toHaveCount(2);
  await expect(page.locator(`[data-lesson-row="${lessonId}"]`)).toContainText(
    'Pre-open sweep fades back inside the range'
  );
  await expect(page.locator(`[data-lesson-row="${lessonId}"]`)).toContainText('pre-open');

  // Delete the edited one, then the other, leaving a self-explaining empty library.
  await page
    .locator(`[data-lesson-row="${lessonId}"] button[title="Delete this lesson"]`)
    .click();
  await expect(rows).toHaveCount(1);
  await rows.first().locator('button[title="Delete this lesson"]').click();
  await expect(page.getByText('No lessons saved yet')).toBeVisible();
});

/**
 * The repetition read: writing the same finding down twice raises the panel, badges both lessons
 * and names the group, without any AI call being made.
 */
test('flags a lesson the trader keeps writing down again', async ({ page }) => {
  await gotoLessons(page);

  await addLesson(page, {
    title: 'Overnight high gets swept before the open',
    kind: 'mistake',
    tags: 'liquidity, pre-open',
  });

  // One lesson cannot repeat itself, so the panel is not there yet.
  await expect(page.locator('#lesson-recurrence')).toHaveCount(0);

  await addLesson(page, {
    title: 'Pre-open sweep of the overnight high',
    kind: 'mistake',
    tags: 'liquidity, pre-open',
  });

  // This note reads like the first, so the save-time warning has to be acknowledged first.
  await page.locator('#lesson-duplicate-confirm').click();

  const panel = page.locator('#lesson-recurrence');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Repeating lessons');
  await expect(panel.locator('[data-lesson-repeat-cluster]')).toHaveCount(1);
  // Both members are badged, and the shared tags the panel grouped them by are named.
  await expect(page.locator('[data-lesson-repeat-badge]')).toHaveCount(2);
  await expect(panel).toContainText('pre-open');

  // Opening a member from the panel rings its row in the list below.
  const member = panel.locator('[data-lesson-repeat-member]').first();
  const memberId = await member.getAttribute('data-lesson-repeat-member');
  await member.click();
  await expect(page.locator(`[data-lesson-row="${memberId}"]`)).toHaveClass(/ring-2/);
});

/**
 * The save-time duplicate read: writing a second lesson that reads like one already saved raises
 * a warning naming the original, and the trader still gets the last word.
 */
test('warns when a new lesson repeats one already saved', async ({ page }) => {
  await gotoLessons(page);

  await addLesson(page, {
    title: 'Overnight high gets swept before the open',
    kind: 'mistake',
    tags: 'liquidity, pre-open',
  });
  await expect(page.locator('[data-lesson-row]')).toHaveCount(1);

  // Write a second note that says the same thing in different words.
  await page.locator('#lesson-add').click();
  await page.locator('#lesson-title').fill('Pre-open sweep of the overnight high');
  await page.locator('#lesson-kind').selectOption('mistake');
  await page.locator('#lesson-tags').fill('liquidity, pre-open');
  await page.locator('#lesson-save').click();

  // The warning names the original and holds the save back.
  const warning = page.locator('#lesson-duplicate-warning');
  await expect(warning).toBeVisible();
  await expect(warning.locator('[data-lesson-duplicate]')).toHaveCount(1);
  await expect(warning).toContainText('Overnight high gets swept before the open');
  await expect(page.locator('[data-lesson-row]')).toHaveCount(1);

  // Dismissing it clears the warning; saving again re-checks and raises it again.
  await page.locator('#lesson-duplicate-dismiss').click();
  await expect(page.locator('#lesson-duplicate-warning')).toHaveCount(0);
  await page.locator('#lesson-save').click();
  await expect(page.locator('#lesson-duplicate-warning')).toBeVisible();

  // Confirming that it is genuinely new saves it as its own lesson.
  await page.locator('#lesson-duplicate-confirm').click();
  await expect(page.locator('[data-lesson-row]')).toHaveCount(2);
  await expect(page.getByText('You have already written this down')).toHaveCount(0);
});

/**
 * The media half of a lesson: a screenshot attaches, saves with the lesson, is counted for the
 * coach's read, and survives a reload — the whole point being that the picture the trader took
 * at the time is still there weeks later.
 */
test('attaches a screenshot and keeps it through the save and a reload', async ({ page }) => {
  await gotoLessons(page);
  await addLesson(page, { title: 'Sweep of the overnight high', kind: 'pattern' });

  // Reopen the row to attach the picture to the lesson that already exists.
  const row = page.locator('[data-lesson-row]').first();
  const lessonId = await row.getAttribute('data-lesson-row');
  await page.locator(`#lesson-edit-${lessonId}`).click();
  await page.locator('#lesson-media-file-input').setInputFiles({
    name: 'sweep.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.locator('#lesson-media-container')).toContainText('1 / 6 attached');
  await page.locator('#lesson-save').click();

  await expect(row).toContainText('1 image(s)');
  await expect(row.locator('img')).toHaveCount(1);

  // The coach card counts the still image it will send with the read.
  const coachCard = page.locator('#playbook-coach-lessons');
  await expect(coachCard.locator('#coach-lessons-facts')).toContainText('Screenshots sent');
  await expect(coachCard).toContainText('1 still image(s) travel with the read');

  // Reload: the compressed data URL is still on the lesson, and still counted.
  await page.reload();
  await gotoLessons(page);
  const reloaded = page.locator(`[data-lesson-row="${lessonId}"]`);
  await expect(reloaded).toContainText('1 image(s)');
  await expect(reloaded.locator('img')).toHaveCount(1);
  await expect(page.locator('#playbook-coach-lessons')).toContainText(
    '1 still image(s) travel with the read'
  );
});
