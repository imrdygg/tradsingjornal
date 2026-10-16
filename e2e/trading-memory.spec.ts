import { test, expect, type Page } from '@playwright/test';

/**
 * Trading Memory, driven the way the trader drives it.
 *
 * The specs run against a local-only build (the config strips the Supabase variables), which is
 * the interesting case for this feature rather than an inconvenience: with no cloud there is no
 * private bucket and no vector index, so these tests pin down what the screen says when the
 * memory cannot be searched — that it explains why, and that it still lets a sighting be recorded
 * and read. A screen that quietly pretended to search would pass a test that only checked the
 * button existed.
 */

/** A real one-pixel PNG, so the uploader has something it can actually decode and compress. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Both a desktop tab and a mobile tab exist in the DOM; only one is ever visible. */
function memoryTab(page: Page) {
  return page.locator('#nav-btn-memory, #mobile-nav-memory').filter({ visible: true }).first();
}

async function openMemory(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    // Start from an empty library so a re-run cannot depend on what the last run left behind.
    localStorage.removeItem('ptj_observations_v1');
    localStorage.removeItem('ptj_memory_ai_v1');
  });
  await page.reload();
  await memoryTab(page).click();
  await expect(page.locator('#observation-library')).toBeVisible();
}

test.describe('Trading Memory', () => {
  test('is reachable from the navigation and states what it is', async ({ page }) => {
    await openMemory(page);
    await expect(page.getByRole('heading', { name: 'Trading Memory' })).toBeVisible();
    await expect(page.locator('#observation-empty')).toContainText('Nothing recorded yet');
  });

  test('needs consent before anything may be sent, and starts with it off', async ({ page }) => {
    await openMemory(page);
    const consent = page.locator('#memory-consent-toggle');
    await expect(consent).toBeVisible();
    await expect(consent).not.toBeChecked();
    // The prerequisite checklist must agree with the switch, from real state.
    await expect(page.locator('#memory-prereq-consent')).toHaveAttribute('data-met', 'false');
  });

  test('says the search is not available yet rather than offering a search that finds nothing', async ({
    page,
  }) => {
    await openMemory(page);
    // Local-only build: no project, so no private storage and no index.
    await expect(page.locator('#memory-prereq-cloud')).toHaveAttribute('data-met', 'false');
    await expect(page.locator('#memory-prereq-pictures')).toHaveAttribute('data-met', 'false');
    await expect(page.locator('#memory-search-readiness')).toContainText('Supabase');
  });

  test('records a sighting with no trade attached', async ({ page }) => {
    await openMemory(page);

    await page.locator('#observation-new').click();
    await expect(page.locator('#observation-form')).toBeVisible();

    // Saving is refused until a contract is chosen, because a sighting with no instrument cannot
    // be grouped or compared against anything.
    await expect(page.locator('#observation-save')).toBeDisabled();

    await page.locator('#observation-instrument').selectOption({ index: 1 });
    await page.locator('#observation-setup').selectOption({ index: 1 });
    await page.locator('#observation-timeframe').selectOption('5m');
    await page.locator('#observation-session').selectOption('Overnight');
    await page.locator('#observation-context').fill('Overnight swept the low and held.');
    await page.locator('#observation-notes').fill('Watching for a reclaim of the session high.');

    await expect(page.locator('#observation-save')).toBeEnabled();
    await page.locator('#observation-save').click();

    await expect(page.locator('#observation-form')).toBeHidden();
    await expect(page.locator('#observation-list article')).toHaveCount(1);
    await expect(page.locator('#observation-list')).toContainText('Overnight swept the low');
    // No trade was taken, and the card says so rather than leaving a blank.
    await expect(page.locator('#observation-list')).toContainText('no trade taken');
    // The outcome has not been recorded, so it reads as unrecorded rather than as a reversal.
    await expect(page.locator('#observation-list')).toContainText('not recorded');
  });

  test('keeps a screenshot in the browser, unindexed, when there is no cloud', async ({ page }) => {
    await openMemory(page);
    await page.locator('#observation-new').click();

    await page.locator('#observation-before-input').setInputFiles({
      name: 'chart.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64'),
    });

    // Local-only: the picture stays inline and is labelled as such.
    await expect(page.locator('#observation-before-preview')).toBeVisible();
    await expect(page.locator('#observation-form')).toContainText('in this browser');
    // Consent is off, so nothing was queued for indexing and the record says so.
    await expect(page.locator('#observation-form')).toContainText('skipped');

    await page.locator('#observation-instrument').selectOption({ index: 1 });
    await page.locator('#observation-save').click();

    await expect(page.locator('#observation-list article')).toHaveCount(1);
    await expect(page.locator('#observation-list')).toContainText('not sent for indexing');
  });

  test('can edit a saved sighting without creating a second one', async ({ page }) => {
    await openMemory(page);

    await page.locator('#observation-new').click();
    await page.locator('#observation-instrument').selectOption({ index: 1 });
    await page.locator('#observation-context').fill('First read.');
    await page.locator('#observation-save').click();
    await expect(page.locator('#observation-list article')).toHaveCount(1);

    await page.locator('#observation-list article').first().locator('[id^="observation-edit-"]').click();
    await page.locator('#observation-context').fill('Rewritten after the close.');
    await page.locator('#observation-save').click();

    await expect(page.locator('#observation-list article')).toHaveCount(1);
    await expect(page.locator('#observation-list')).toContainText('Rewritten after the close.');
  });

  test('records what happened afterwards, and keeps it apart from the execution', async ({
    page,
  }) => {
    await openMemory(page);

    await page.locator('#observation-new').click();
    await page.locator('#observation-instrument').selectOption({ index: 1 });
    await page.locator('#observation-save').click();

    await page.locator('#observation-list article').first().locator('[id^="observation-outcome-toggle-"]').click();
    const outcomePanel = page.locator('[id^="observation-outcome-obs-"]').first();
    await expect(outcomePanel).toBeVisible();
    // The panel states the rule it enforces: an unwatched observation is unknown, not a reversal.
    await expect(outcomePanel).toContainText('never as a reversal');

    await outcomePanel.locator('[id^="outcome-status-"]').selectOption('recorded');
    await outcomePanel.locator('[id^="outcome-continuation-"]').selectOption('continuation');
    await outcomePanel.locator('[id^="outcome-window-"]').fill('30 minutes after the open');

    // Market and execution are labelled separately in the list, never blended into one figure.
    await expect(page.locator('#observation-list')).toContainText('Market:');
    await expect(page.locator('#observation-list')).toContainText('You:');
    await expect(page.locator('#observation-list')).toContainText('continuation');
  });

  test('filters the library and clears the filter again', async ({ page }) => {
    await openMemory(page);

    for (const text of ['Alpha read.', 'Beta read.']) {
      await page.locator('#observation-new').click();
      await page.locator('#observation-instrument').selectOption({ index: 1 });
      await page.locator('#observation-context').fill(text);
      await page.locator('#observation-save').click();
    }
    await expect(page.locator('#observation-list article')).toHaveCount(2);

    await page.locator('#observation-search').fill('Alpha');
    await expect(page.locator('#observation-list article')).toHaveCount(1);
    await expect(page.locator('#observation-list')).toContainText('Alpha read.');

    await page.locator('#observation-search').fill('');
    await expect(page.locator('#observation-list article')).toHaveCount(2);
  });

  test('deletes a sighting', async ({ page }) => {
    await openMemory(page);

    await page.locator('#observation-new').click();
    await page.locator('#observation-instrument').selectOption({ index: 1 });
    await page.locator('#observation-save').click();
    await expect(page.locator('#observation-list article')).toHaveCount(1);

    await page.locator('#observation-list article').first().locator('[id^="observation-delete-"]').click();
    await expect(page.locator('#observation-empty')).toContainText('Nothing recorded yet');
  });
});
