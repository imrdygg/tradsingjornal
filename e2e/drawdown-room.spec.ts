import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the account drawdown room on Today:
 *  - the number moves with the journal rather than sitting on the agreed figure
 *  - profit adds room above it; a loss takes it back
 *
 * The room was read from the equity high-water mark, which meant a winning run left it parked
 * on the agreed limit — the reading the trader reported as broken. A fresh journal starts
 * with the default $1,000 limit and a $100 daily loss plan, so every figure below is the
 * default plus whatever the recorded trade did.
 */

/**
 * The Today tab opens on the review, the trend, the search box and the day's trades; the
 * drawdown strip is down with the plan, behind one folded section.
 */
async function expandTodayAdvanced(page: Page) {
  // Addressed by the body it controls, not by aria-expanded: the section holds other
  // collapsibles, so "any collapsed button inside it" is not the section's own toggle.
  const toggle = page.locator('button[aria-controls="section-today-advanced-body"]').first();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

/**
 * Records one closed MES trade of 2 contracts, so a 10-point move is $100 at MES's $5/point.
 * Closed at the moment it is written, because the room only counts realized P&L.
 */
async function recordClosedTrade(page: Page, entry: number, exit: number) {
  await page.locator('#btn-add-trade-top').click();
  await expect(page.getByRole('heading', { name: /Log a Trade/i })).toBeVisible();
  await page.locator('#trade-entry-price').fill(String(entry));
  await page.locator('#trade-initial-stop').fill(String(entry - 20));
  await page.locator('#trade-contracts').fill('2');
  await page.locator('#trade-exit-price').fill(String(exit));
  await page.getByRole('button', { name: /Save Completed Trade/i }).click();
  await expect(page.getByRole('heading', { name: /Today's Trade Executions/i })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('The drawdown room follows the journal', () => {
  test('a winning trade adds room above the agreed drawdown', async ({ page }) => {
    await expandTodayAdvanced(page);
    const strip = page.locator('#drawdown-room');
    await expect(strip).toContainText('$1,000.00 room left');
    await expect(strip).toContainText('10 more losing days');

    // +$100 → the room is the agreed limit plus the profit, not the limit again.
    await recordClosedTrade(page, 7730, 7740);
    await expandTodayAdvanced(page);

    await expect(strip).toContainText('$1,100.00 room left');
    await expect(strip).toContainText('$100.00 of profit on top of $1,000.00');
    await expect(strip).toContainText('11 more losing days');
  });

  test('a losing trade takes the room back down and reports what it spent', async ({ page }) => {
    // -$100 → the limit is partly spent, so the strip switches to the used-of reading.
    await recordClosedTrade(page, 7730, 7720);
    await expandTodayAdvanced(page);

    const strip = page.locator('#drawdown-room');
    await expect(strip).toContainText('$900.00 room left');
    await expect(strip).toContainText('used $100.00 of $1,000.00');
    await expect(strip).toContainText('(90% left)');
    // 10% of the agreed limit spent is the widest room the strip reports.
    await expect(strip).toHaveAttribute('data-stance', 'ample');
  });
});
