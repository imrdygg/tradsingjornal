import { expect, test, type Page } from '@playwright/test';

/**
 * The three things a trader reported as dead in Trading Memory:
 *  - "Record a sighting" opened a form below the fold, so the click looked like nothing
 *  - labelling an imported picture gave no visible answer
 *  - clicking a chart did not open it larger
 *
 * Each test drives the real screen with a seeded record, because the failures were all about
 * what the browser does after a click rather than about the data layer underneath it.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SEEDED_OBSERVATION = {
  id: 'obs-probe',
  userId: 'local-user',
  observedAt: '2026-10-01T13:30:00.000Z',
  observedAtSource: 'recorded',
  marketTimezone: 'America/New_York',
  instrumentId: 'mes',
  symbol: 'MES',
  images: [
    {
      id: 'img-1',
      observationId: 'obs-probe',
      role: 'context',
      dataUrl: PNG,
      mimeType: 'image/png',
      indexStatus: 'skipped',
      createdAt: '2026-10-01T13:31:00.000Z',
      updatedAt: '2026-10-01T13:31:00.000Z',
    },
  ],
  createdAt: '2026-10-01T13:31:00.000Z',
  updatedAt: '2026-10-01T13:31:00.000Z',
};

async function openMemory(page: Page, seed = true) {
  await page.addInitScript(
    ({ observation, withSeed }) => {
      // Once per browser context, not once per navigation: a reload has to see what the click
      // wrote, not have the seed put back over it.
      if (sessionStorage.getItem('ptj_memory_fix_seeded')) return;
      sessionStorage.setItem('ptj_memory_fix_seeded', '1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ptj_')) localStorage.removeItem(key);
      }
      if (withSeed) {
        localStorage.setItem('ptj_observations_v1', JSON.stringify([observation]));
      }
    },
    { observation: SEEDED_OBSERVATION, withSeed: seed }
  );
  await page.goto('/');
  const desktop = page.locator('#nav-btn-memory');
  if (await desktop.isVisible()) await desktop.click();
  else await page.locator('#mobile-nav-memory').click();
  await expect(page.locator('#observation-library')).toBeVisible();
}

const card = (page: Page) => page.locator('[data-observation-id="obs-probe"]');

test('Record a sighting opens a dialog that is actually on screen', async ({ page }) => {
  await openMemory(page, false);

  await page.locator('#observation-new').click();

  const form = page.locator('#observation-form');
  await expect(form).toBeVisible();
  await expect(form).toBeInViewport();
  // It is a dialog, not an inline panel that opened below the fold.
  await expect(page.locator('[role="dialog"][aria-label="Record a sighting"]')).toBeVisible();

  await page.locator('#observation-instrument').selectOption('mes');
  await page.locator('#observation-save').click();

  await expect(page.locator('[data-observation-id]')).toHaveCount(1);
  await expect(page.locator('#observation-form')).toHaveCount(0);
  await expect(page.locator('#observation-list')).toContainText('MES');
});

test('closing the dialog with Escape leaves the record alone', async ({ page }) => {
  await openMemory(page, false);

  await page.locator('#observation-new').click();
  await expect(page.locator('#observation-form')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.locator('#observation-form')).toHaveCount(0);
  await expect(page.locator('#observation-empty')).toContainText('Nothing recorded yet');
});

test('labelling a picture says so, and survives a reload', async ({ page }) => {
  await openMemory(page);

  await expect(card(page).locator('[id^="observation-unlabelled-"]')).toBeVisible();
  await page.locator('[id^="observation-label-"]').first().click();

  // The answer is said back, not just a strip silently disappearing.
  await expect(page.locator('#observation-label-notice')).toBeVisible();
  await expect(page.locator('#observation-label-notice')).toContainText(
    'labelled as the picture from before your decision'
  );
  await expect(card(page).locator('[id^="observation-unlabelled-"]')).toHaveCount(0);

  await page.reload();
  const desktop = page.locator('#nav-btn-memory');
  if (await desktop.isVisible()) await desktop.click();
  else await page.locator('#mobile-nav-memory').click();
  await expect(page.locator('#observation-library')).toBeVisible();

  await expect(page.locator('[id^="observation-unlabelled-"]')).toHaveCount(0);
  await expect(card(page)).toContainText('not sent for indexing');
});

test('the waiting-for-a-label count takes you to the picture that is waiting', async ({ page }) => {
  await openMemory(page);

  const count = page.locator('#memory-journal-import-unlabelled');
  await expect(count).toHaveText(/1/);
  await count.click();

  // The count reads like a filter, so pressing it has to land on something: the record holding
  // the unlabelled picture is brought into view and rung, and the label button is right there.
  await expect(card(page)).toHaveAttribute('data-focused', 'true');
  await expect(card(page).locator('[id^="observation-label-"]')).toBeInViewport();
});

test('the waiting-for-a-label count clears filters instead of dying behind them', async ({ page }) => {
  await openMemory(page);

  // A session the seeded record does not have: the list is empty and the record is not rendered.
  await page.locator('#observation-filters-toggle').click();
  await page.locator('#observation-filter-session').selectOption('Premarket');
  await expect(card(page)).toHaveCount(0);

  await page.locator('#memory-journal-import-unlabelled').click();

  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute('data-focused', 'true');
  await expect(card(page).locator('[id^="observation-label-"]')).toBeInViewport();
});

test('clicking a chart opens the lightbox, and Escape closes it', async ({ page }) => {
  await openMemory(page);

  const thumb = card(page).locator('button:has(img)').first();
  await expect(thumb).toBeVisible();
  await thumb.click();

  await expect(page.locator('#image-lightbox-overlay')).toBeVisible();
  await expect(page.locator('#image-lightbox-overlay img')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#image-lightbox-overlay')).toHaveCount(0);
});
