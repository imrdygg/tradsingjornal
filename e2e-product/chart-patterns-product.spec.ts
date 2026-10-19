import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * The product a buyer receives: one HTML file and its assets, no journal, no server.
 *
 * These specs deliberately do not touch the journal's navigation. If they pass, the zip
 * boots on its own, gates on a license key, keeps a study after a reload, honours the
 * per-pattern URL, and moves data in and out through files.
 */

const DOUBLE_TOP = 'reversal-bearish-double-top';
const LICENSE = 'WTKP4-66NL5-HMKQW-GFSCZ';

const cardCount = (page: Page) => page.locator('[id^="pattern-card-"]');

test.beforeEach(async ({ page }) => {
  // A fresh product install per test. The sessionStorage guard keeps the clear from
  // wiping data when the test itself reloads the page to prove persistence.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('playbook_e2e_cleared')) return;
    sessionStorage.setItem('playbook_e2e_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
});

/** Opens the product, taking the trial when the activation screen is shown. */
async function enterProduct(page: Page, hash = '') {
  await page.goto(`/chart-patterns.html${hash}`);
  const trial = page.locator('#license-start-trial');
  if (await trial.isVisible()) await trial.click();
  await expect(page.locator('#chart-patterns-section')).toBeVisible();
}

test.describe('activation', () => {
  test('a fresh install is gated, rejects a malformed key, and the trial survives a reload', async ({
    page,
  }) => {
    await page.goto('/chart-patterns.html');

    await expect(page.locator('#license-screen')).toBeVisible();
    await expect(page.locator('#chart-patterns-section')).toHaveCount(0);

    await page.locator('#license-key-input').fill('not-a-key');
    await page.locator('#license-activate').click();
    await expect(page.locator('#license-error')).toContainText(/license key/i);
    await expect(page.locator('#license-screen')).toBeVisible();

    await page.locator('#license-start-trial').click();
    await expect(page.locator('#chart-patterns-section')).toBeVisible();
    await expect(page.locator('#product-license')).toContainText('Trial · 7d');

    await page.reload();
    await expect(page.locator('#chart-patterns-section')).toBeVisible();
    await expect(page.locator('#license-screen')).toHaveCount(0);
  });

  test('a Payhip-shaped key activates the device and is remembered, masked in the dialog', async ({
    page,
  }) => {
    await page.goto('/chart-patterns.html');
    await page.locator('#license-key-input').fill(LICENSE.toLowerCase());
    await page.locator('#license-activate').click();

    await expect(page.locator('#chart-patterns-section')).toBeVisible();
    await expect(page.locator('#product-license')).toContainText('Licensed');

    await page.reload();
    await expect(page.locator('#chart-patterns-section')).toBeVisible();

    await page.locator('#product-license').click();
    await expect(page.locator('#license-dialog')).toContainText('•');
    await expect(page.locator('#license-dialog')).toContainText('WTKP4');
  });
});

test.describe('the library', () => {
  test('shows all 20 patterns and filters them', async ({ page }) => {
    await enterProduct(page);

    await expect(cardCount(page)).toHaveCount(20);
    await page.locator('#pattern-filter-category-reversal').click();
    await expect(cardCount(page)).toHaveCount(10);
    await page.locator('#pattern-filter-bias-neutral').click();
    await expect(cardCount(page)).toHaveCount(0);
    await expect(page.locator('#chart-patterns-section')).toContainText(
      'No patterns match those filters'
    );
  });

  test('keeps a study after a reload and opens it from its own URL', async ({ page }) => {
    await enterProduct(page);

    await page.locator(`#pattern-study-${DOUBLE_TOP}`).click();
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toBeVisible();
    expect(new URL(page.url()).hash).toBe(`#chart-patterns/${DOUBLE_TOP}`);

    await page.locator('#pattern-check-universal-0').click();
    await page.locator(`#pattern-status-${DOUBLE_TOP}`).selectOption('confirmed');
    await page.locator('#pattern-notes').fill('Watched the same top form twice this week.');
    await page.locator('#pattern-save-notes').click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);

    await page.reload();
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toBeVisible();
    await expect(page.locator('#pattern-notes')).toHaveValue(
      'Watched the same top form twice this week.'
    );
    await expect(page.locator('#pattern-check-universal-0')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // The product owns the URL, not the journal's tab router.
    await page.goto(`/chart-patterns.html#chart-patterns/${DOUBLE_TOP}`);
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toBeVisible();
  });
});

test.describe('moving data', () => {
  test('exports an envelope and imports a full journal backup', async ({ page }) => {
    await enterProduct(page);

    await page.evaluate(() => {
      localStorage.setItem(
        'ptj_pattern_studies_v1',
        JSON.stringify([
          {
            patternId: 'reversal-bearish-double-top',
            status: 'confirmed',
            checklist: ['universal:0'],
            notes: 'Seeded for the export.',
            entries: [],
            updatedAt: new Date().toISOString(),
          },
        ])
      );
    });
    await page.reload();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#product-export').click();
    const download = await downloadPromise;
    const downloaded = fs.readFileSync((await download.path()) as string, 'utf8');

    const envelope = JSON.parse(downloaded) as {
      app: string;
      studies: Array<{ notes: string }>;
    };
    expect(envelope.app).toBe('chart-pattern-playbook');
    expect(envelope.studies[0].notes).toBe('Seeded for the export.');

    // A journal backup carries `patternStudies`, not `studies`: the product must accept it
    // so a buyer can move the notes they kept into the full app, and back again.
    await page.evaluate(() => localStorage.removeItem('ptj_pattern_studies_v1'));
    await page.reload();
    await expect(cardCount(page)).toHaveCount(20);

    await page.locator('#product-import-file').setInputFiles({
      name: 'trading-journal-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          profile: { id: 'solo-trader-01' },
          patternStudies: [
            {
              patternId: 'reversal-bearish-double-top',
              status: 'confirmed',
              checklist: [],
              notes: 'Imported from the journal.',
              entries: [],
              updatedAt: new Date().toISOString(),
            },
          ],
        })
      ),
    });

    await expect(page.locator('#product-notice')).toContainText('Imported 1 studied pattern');
    await page.locator(`#pattern-study-${DOUBLE_TOP}`).click();
    await expect(page.locator('#pattern-notes')).toHaveValue('Imported from the journal.');
  });

  test('refuses a JSON file that is not a playbook export', async ({ page }) => {
    await enterProduct(page);

    await page.locator('#product-import-file').setInputFiles({
      name: 'something-else.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ trades: [] })),
    });

    await expect(page.locator('#product-notice')).toContainText('no pattern studies');
    await expect(cardCount(page)).toHaveCount(20);
  });
});
