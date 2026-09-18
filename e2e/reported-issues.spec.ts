import { expect, test, type Page } from '@playwright/test';

/**
 * Regression tests for the issues reported against the Playbook and the
 * position scale-in calculator:
 *
 *  1. Recording a trade only offered one setup — every playbook setup must be
 *     selectable, including ones toggled "off".
 *  2. Setup names were visually cut off on the Playbook cards.
 *  3. The break-even calculator shipped hard-coded example prices — it must
 *     auto-fill from the trader's real open trade instead.
 */

async function gotoPlaybook(page: Page) {
  const desktop = page.locator('#nav-btn-playbook');
  const mobile = page.locator('#mobile-nav-playbook');
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await expect(
    page.getByRole('heading', { name: /Trading Setups & Playbook Library/i })
  ).toBeVisible();
}

async function gotoTab(page: Page, tab: string, heading: RegExp) {
  const desktop = page.locator(`#nav-btn-${tab}`);
  const mobile = page.locator(`#mobile-nav-${tab}`);
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function openAddTrade(page: Page) {
  await page.locator('#btn-add-trade-top').click();
  await expect(
    page.getByRole('heading', { name: /Record Futures Trade/i })
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Recording a trade lists every playbook setup', () => {
  test('all default setups appear in the Setup dropdown', async ({ page }) => {
    await openAddTrade(page);

    const select = page.locator('#trade-setup-select');
    await expect(select).toBeVisible();

    const expected = [
      'Engulfing',
      'Support',
      'Resistance',
      'Breakout',
      'Reversal',
      'Trend Continuation',
      'Other',
    ];

    const options = await select.locator('option').allTextContents();
    expect(options.length).toBe(expected.length);
    for (const name of expected) {
      expect(options.some((o) => o.trim() === name)).toBeTruthy();
    }
  });

  test('a setup toggled off in the Playbook is still selectable', async ({ page }) => {
    // Turn Engulfing off from the Playbook card's Active/Off badge.
    await gotoPlaybook(page);
    const card = page
      .locator('div.rounded-2xl', { has: page.getByText('Engulfing', { exact: true }) })
      .first();
    await card.getByTitle(/Active — shown first/).click();
    await expect(card.getByText('Off', { exact: true })).toBeVisible();

    // It must still be offered when recording a trade.
    await gotoTab(page, 'today', /Morning Plan/i);
    await openAddTrade(page);

    const options = await page.locator('#trade-setup-select option').allTextContents();
    expect(options.some((o) => o.trim().startsWith('Engulfing'))).toBeTruthy();
    expect(options.length).toBe(7);
  });

  test('a freshly added setup is immediately available', async ({ page }) => {
    await gotoPlaybook(page);
    await page.getByPlaceholder(/Fair Value Gap/).fill('VWAP Reclaim');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await gotoTab(page, 'today', /Morning Plan/i);
    await openAddTrade(page);

    const options = await page.locator('#trade-setup-select option').allTextContents();
    expect(options.some((o) => o.trim() === 'VWAP Reclaim')).toBeTruthy();
  });
});

test.describe('Playbook setup names are shown in full', () => {
  test('a long setup name wraps instead of being clipped', async ({ page }) => {
    await gotoPlaybook(page);

    const longName = 'Liquidity Sweep Reversal Off The Prior Day Low';
    await page.getByPlaceholder(/Fair Value Gap/).fill(longName);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const nameEl = page.getByTitle(longName);
    await expect(nameEl).toBeVisible();

    // The visible text box must be able to show the whole name.
    const overflow = await nameEl.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Break-even calculator uses real numbers', () => {
  test('auto-fills from the open trade instead of an example price', async ({ page }) => {
    // Log a real open position: 2 contracts long from 6700.00.
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('6700');
    await page.locator('#trade-initial-stop').fill('6680');
    await page.locator('#trade-contracts').fill('2');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    // The calculator should have picked the real fill up, not 7730/7700.
    await expect(page.locator('#breakeven-entry-price')).toHaveValue('6700.00');
    await expect(page.locator('#breakeven-contracts-held')).toHaveValue('2');
    await expect(page.locator('#breakeven-current-price')).toHaveValue('6700.00');

    // And the dollar figures must use MES's real $5/point.
    await page.locator('#breakeven-current-price').fill('6690');
    await expect(page.getByText(/\$5\.00\/pt/).first()).toBeVisible();
    await expect(
      page.getByText('New Average Entry = Break-Even Price')
    ).toBeVisible();
  });

  test('no example preset buttons remain on the calculator', async ({ page }) => {
    await expect(page.getByText(/Your Example \(1 @ 7730/i)).toHaveCount(0);
    await expect(page.getByText(/Down \$50 Example/i)).toHaveCount(0);
  });
});

test.describe('Logging a scale-in as its own trade', () => {
  test('pre-fills the record form and saves a second open trade', async ({ page }) => {
    // Start with a real open position: 1 long from 7730.
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    // Describe the add: 5 more contracts at 7700 with price now at 7700.
    await page.locator('#breakeven-current-price').fill('7700');
    await page.locator('#breakeven-add-price').fill('7700');
    await page.locator('#breakeven-contracts-to-add').fill('5');

    // New average must be 7705 -> a 5 point bounce from the add.
    await expect(page.getByText('7,705.00').first()).toBeVisible();

    await page.locator('#breakeven-log-scale-in').click();

    // The record form opens as a NEW trade, pre-filled with the add.
    await expect(page.getByRole('heading', { name: /Record Futures Trade/i })).toBeVisible();
    await expect(page.getByText(/Pre-filled from the break-even calculator/i)).toBeVisible();
    await expect(page.locator('#trade-entry-price')).toHaveValue('7700');
    await expect(page.locator('#trade-contracts')).toHaveValue('5');

    // The stop is intentionally left for the trader to decide.
    await page.locator('#trade-initial-stop').fill('7690');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    // Both entries are now recorded as separate trades.
    await expect(
      page.getByRole('heading', { name: /Today's Trade Executions \(2\)/i })
    ).toBeVisible();
    await expect(page.getByText(/2 Open/).first()).toBeVisible();
  });

  test('the trade list shows the combined size and average entry', async ({ page }) => {
    // Open 1 @ 7730, then scale in 5 @ 7700 -> 6 contracts, average 7705.
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    await page.locator('#breakeven-current-price').fill('7700');
    await page.locator('#breakeven-add-price').fill('7700');
    await page.locator('#breakeven-contracts-to-add').fill('5');
    await page.locator('#breakeven-log-scale-in').click();
    await page.locator('#trade-initial-stop').fill('7690');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    // Today: both legs are badged as one position of 2 legs at the blended entry.
    await expect(page.getByText(/Combined position · 2 legs/).first()).toBeVisible();
    await expect(page.getByText(/6 MES · avg entry 7705\.00/).first()).toBeVisible();

    // Trade log: the desktop table and the mobile cards each carry it too.
    await gotoTab(page, 'trades', /Trade Log/i);
    if (await page.locator('table').first().isVisible()) {
      await expect(page.getByText(/6 MES total/).first()).toBeVisible();
      await expect(page.getByText(/avg 7705\.00/).first()).toBeVisible();
    } else {
      await expect(page.getByText(/6 MES · avg entry 7705\.00/).first()).toBeVisible();
    }
  });

  test('a standalone trade is not badged as a position', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    await expect(page.getByText(/Combined position/)).toHaveCount(0);
  });

  test('the log button is disabled until the numbers make sense', async ({ page }) => {
    // No open trade and no manual entry yet.
    await expect(page.locator('#breakeven-log-scale-in')).toBeDisabled();

    await page.locator('#breakeven-entry-price').fill('7730');
    await page.locator('#breakeven-add-price').fill('7700');
    await expect(page.locator('#breakeven-log-scale-in')).toBeEnabled();
  });
});
