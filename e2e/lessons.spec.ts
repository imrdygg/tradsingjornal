import { expect, test, type Page } from '@playwright/test';

/**
 * The Lessons tab of the Playbook.
 *
 * A lesson is the trader's own documented finding, with screenshots and short clips. These
 * tests cover the parts a trader actually relies on: writing one down, filing it under a kind
 * and a tag, finding it again by search or filter, editing it in place, and having it survive a
 * reload — plus the dedicated coach card that reads the library on request.
 */

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
