import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * The MES tracker a buyer receives: one HTML file and its assets, no journal, no server.
 *
 * These specs prove the artifact works on its own: activation, logging a level through the
 * real form, persistence across reloads, export, and restoring a full journal backup.
 */

const LICENSE = 'WTKP4-66NL5-HMKQW-GFSCZ';

const FIXTURE = {
  id: 'lvl-fixture',
  date: '2026-10-16',
  timeframe: '5m',
  kind: 'support',
  price: 5823.25,
  touches: 3,
  holds: 2,
  breaks: 1,
  setup: 'rejection',
  hitTime: '09:35',
  breakTime: '11:05',
  breakDirection: 'down',
  notes: 'Held twice, broke on the third test.',
  createdAt: 1,
  updatedAt: 1,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mes_e2e_cleared')) return;
    sessionStorage.setItem('mes_e2e_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
});

async function enterProduct(page: Page) {
  await page.goto('/mes-tracker.html');
  const trial = page.locator('#license-start-trial');
  if (await trial.isVisible()) await trial.click();
  await expect(page.locator('#mes-tab-dashboard')).toBeVisible();
}

test.describe('activation', () => {
  test('a fresh install is gated, rejects a malformed key, and the trial survives a reload', async ({
    page,
  }) => {
    await page.goto('/mes-tracker.html');
    await expect(page.locator('#license-screen')).toBeVisible();
    await expect(page.locator('#mes-tab-dashboard')).toHaveCount(0);

    await page.locator('#license-key-input').fill('not-a-key');
    await page.locator('#license-activate').click();
    await expect(page.locator('#license-error')).toContainText(/license key/i);

    await page.locator('#license-start-trial').click();
    await expect(page.locator('#mes-tab-dashboard')).toBeVisible();
    await expect(page.locator('#product-license')).toContainText('Trial · 7d');

    await page.reload();
    await expect(page.locator('#mes-tab-dashboard')).toBeVisible();
    await expect(page.locator('#license-screen')).toHaveCount(0);
  });

  test('a Payhip-shaped key activates the device and is remembered', async ({ page }) => {
    await page.goto('/mes-tracker.html');
    await page.locator('#license-key-input').fill(LICENSE);
    await page.locator('#license-activate').click();

    await expect(page.locator('#product-license')).toContainText('Licensed');
    await page.reload();
    await expect(page.locator('#mes-tab-dashboard')).toBeVisible();
    await expect(page.locator('#product-license')).toContainText('Licensed');
  });
});

test.describe('tracking', () => {
  test('logs a level through the daily form and keeps it after a reload', async ({ page }) => {
    await enterProduct(page);

    await page.locator('#mes-tab-daily').click();
    await page.locator('#mes-add-5m').click();
    await page.locator('#mes-price-5m').fill('5823.25');
    await page.locator('#mes-save-5m').click();

    await expect(page.locator('#mes-product-count')).toContainText('1 level logged');

    await page.reload();
    await expect(page.locator('#mes-product-count')).toContainText('1 level logged');

    // The daily panel now lists the line the trader just logged.
    await page.locator('#mes-tab-daily').click();
    await expect(page.getByText('5,823.25').first()).toBeVisible();
  });

  test('reads a seeded record on the dashboard and all-levels screens', async ({ page }) => {
    await enterProduct(page);
    await page.evaluate(
      (record) => localStorage.setItem('ptj_mes_levels_v1', JSON.stringify([record])),
      FIXTURE
    );
    await page.reload();

    await expect(page.locator('#mes-product-count')).toContainText('1 level logged');
    await expect(page.locator('#mes-tab-dashboard')).toBeVisible();

    await page.locator('#mes-tab-levels').click();
    await expect(page.getByText('5,823.25').first()).toBeVisible();
  });
});

test.describe('backup and restore', () => {
  test('exports the tracker envelope', async ({ page }) => {
    await enterProduct(page);
    await page.evaluate(
      (record) => localStorage.setItem('ptj_mes_levels_v1', JSON.stringify([record])),
      FIXTURE
    );
    await page.reload();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#mes-export').click();
    const download = await downloadPromise;
    const parsed = JSON.parse(fs.readFileSync((await download.path()) as string, 'utf8')) as {
      app: string;
      records: Array<{ id: string }>;
    };

    expect(parsed.app).toBe('mes-level-tracker');
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].id).toBe('lvl-fixture');
  });

  test('restores a full journal backup through the Data tab', async ({ page }) => {
    await enterProduct(page);
    await page.locator('#mes-tab-data').click();

    // The standalone product must not promise the journal's cloud sync.
    await expect(page.getByText(/only copy/)).toBeVisible();
    await expect(page.getByText(/cloud sync/)).toHaveCount(0);

    page.on('dialog', (dialog) => void dialog.accept());
    await page.locator('#mes-restore-input').setInputFiles({
      name: 'trading-journal-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          profile: { id: 'solo-trader-01' },
          mesLevels: [FIXTURE],
        })
      ),
    });

    await expect(page.locator('#mes-data-status')).toContainText('Restored 1 level');
    await expect(page.locator('#mes-product-count')).toContainText('1 level logged');
  });

  test('refuses a JSON file that has no MES levels', async ({ page }) => {
    await enterProduct(page);
    await page.locator('#mes-tab-data').click();

    page.on('dialog', (dialog) => void dialog.accept());
    await page.locator('#mes-restore-input').setInputFiles({
      name: 'something-else.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ trades: [] })),
    });

    await expect(page.locator('#mes-data-status')).toContainText('no MES levels');
    await expect(page.locator('#mes-product-count')).toContainText('0 levels logged');
  });
});
