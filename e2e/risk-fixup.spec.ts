import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the placeholder risk left behind by a broker CSV import:
 *  - an import is honest that its stop, risk and R are invented
 *  - the bulk fix replaces them with real numbers and clears the flag
 *  - the preview refuses a plan that would produce a nonsense stop
 *
 * A CSV has no stop, so the importer invents a 10-point one. For this file that is
 * 2 MES contracts at $5/pt = $100 of risk, a stop at 7690, and $50 of profit = 0.5R.
 */

const CSV = [
  'Timestamp,Symbol,Action,Qty,Price',
  '2026-09-18 09:31:00,MESZ5,Buy,2,7700.00',
  '2026-09-18 09:35:00,MESZ5,Sell,2,7705.00',
].join('\n');

// The trades view renders a mobile card list and a desktop table at once, one hidden,
// so every assertion here is restricted to the layout actually on screen.
const ASSUMED_BADGES = '[data-assumed-risk]:visible';

/** The risk figure in whichever of the two layouts is currently visible. */
const visibleRisk = (page: Page, value: string) =>
  page.locator('td:visible, span:visible', { hasText: value }).first();

async function gotoTab(page: Page, tab: string) {
  const desktop = page.locator(`#nav-btn-${tab}`);
  const mobile = page.locator(`#mobile-nav-${tab}`);
  if (await desktop.isVisible()) await desktop.click();
  else await mobile.click();
}

async function gotoSettings(page: Page) {
  await gotoTab(page, 'settings');
  // The CSV input is the anchor that proves Settings has rendered.
  await expect(page.locator('input[type="file"][accept=".csv"]')).toBeAttached();
}

async function importCsv(page: Page) {
  await gotoSettings(page);
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles({
    name: 'fills.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  });
  await expect(page.getByText(/Imported 1 trade/i)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Imported risk is flagged, not presented as real', () => {
  test('a fresh import says how many trades still use an assumed stop', async ({ page }) => {
    await importCsv(page);

    await expect(page.locator('#assumed-risk-summary')).toBeVisible();
    await expect(page.locator('#assumed-risk-summary')).toHaveText(/1 trade still use an assumed stop/i);
    await expect(page.locator('#open-risk-fixup')).toBeVisible();

    // And the warning must not silently pass the invented numbers off as real.
    await expect(page.getByText(/risk, R-multiple and expectancy are placeholders/i)).toBeVisible();
  });

  test('the trade itself carries the flag wherever it is shown', async ({ page }) => {
    await importCsv(page);
    await gotoTab(page, 'trades');

    // The flag must be visible on desktop too, where the table — not the card — is
    // what the trader actually reads.
    await expect(page.locator(ASSUMED_BADGES).first()).toBeVisible();
    // The invented 10-point stop on 2 MES contracts.
    await expect(visibleRisk(page, '$100.00')).toBeVisible();
  });

  test('a hand-recorded trade never gets the flag', async ({ page }) => {
    await page.locator('#btn-add-trade-top').click();
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.locator('#trade-exit-price').fill('7740');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    await gotoSettings(page);
    await expect(page.locator('#assumed-risk-summary')).toHaveCount(0);
    await gotoTab(page, 'trades');
    await expect(page.locator(ASSUMED_BADGES)).toHaveCount(0);
  });
});

test.describe('Bulk-applying a real stop', () => {
  test('previews the resulting stop, risk and R before anything is written', async ({ page }) => {
    await importCsv(page);
    await page.locator('#open-risk-fixup').click();

    const modal = page.locator('#risk-fixup-modal');
    await expect(modal).toBeVisible();

    // Default plan is a 10-point stop, which happens to match the placeholder.
    await expect(page.locator('#risk-fixup-summary')).toHaveText(/Average risk: \$100/);

    // 20 points on 2 MES contracts at $5/pt is $200 of risk, and $50 / $200 = 0.25R.
    await page.locator('#risk-fixup-points').fill('20');

    await expect(page.locator('#risk-fixup-summary')).toHaveText(/Average risk: \$200/);
    await expect(modal.getByText('stop 7690 → 7680')).toBeVisible();
    await expect(modal.getByText('risk \$100 → \$200')).toBeVisible();
    await expect(modal.getByText('R 0.5 → 0.25')).toBeVisible();

    // An exact stop cannot be expressed as a distance mentally, so offer the form too.
    await expect(modal.getByRole('button', { name: /Exact stop/i })).toBeVisible();
  });

  test('applies the stop and clears the flag', async ({ page }) => {
    await importCsv(page);
    await page.locator('#open-risk-fixup').click();
    await page.locator('#risk-fixup-points').fill('20');
    await page.locator('#risk-fixup-apply').click();

    // The modal closes and the warning disappears, because nothing is assumed now.
    await expect(page.locator('#risk-fixup-modal')).toHaveCount(0);
    await expect(page.locator('#assumed-risk-summary')).toHaveCount(0);

    await gotoTab(page, 'trades');
    await expect(page.locator(ASSUMED_BADGES)).toHaveCount(0);

    // The real risk is now on the trade: 20 points * $5/pt * 2 contracts = $200.
    await expect(visibleRisk(page, '$200.00')).toBeVisible();
  });

  test('refuses a plan that would produce a meaningless stop', async ({ page }) => {
    await importCsv(page);
    await page.locator('#open-risk-fixup').click();

    await page.locator('#risk-fixup-points').fill('0');

    await expect(page.locator('#risk-fixup-modal')).toContainText(/greater than zero/i);
    await expect(page.locator('#risk-fixup-apply')).toBeDisabled();
  });

  test('a dollar plan spreads the same risk across each trade size', async ({ page }) => {
    await importCsv(page);
    await page.locator('#open-risk-fixup').click();
    await page.locator('#risk-fixup-mode-dollars').click();
    await page.locator('#risk-fixup-dollars').fill('150');

    // $150 over 2 MES contracts at $5/pt is 15 points.
    await expect(page.locator('#risk-fixup-summary')).toHaveText(/Average risk: \$150/);
    await expect(page.locator('#risk-fixup-modal').getByText('stop 7690 → 7685')).toBeVisible();
  });

  test('an empty inventory of assumed risk says so plainly', async ({ page }) => {
    await importCsv(page);
    await page.locator('#open-risk-fixup').click();
    await page.locator('#risk-fixup-points').fill('20');
    await page.locator('#risk-fixup-apply').click();

    // Reopening now has nothing to fix.
    await expect(page.locator('#assumed-risk-summary')).toHaveCount(0);
  });
});
