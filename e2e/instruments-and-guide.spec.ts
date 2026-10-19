import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the two things a bought copy has to do without the seller:
 *  - make the instrument catalog the trader's own (add a stock, correct a contract, remove one)
 *  - explain any screen from the screen itself
 *
 * The journal starts empty, so this also asserts the first run has no demo records.
 */

async function gotoSettings(page: Page) {
  await page.locator('#account-menu-btn').click();
  await page.locator('#account-menu-settings-btn').click();
  await expect(page.locator('#instrument-manager')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ptj_e2e_instruments_cleared')) return;
    sessionStorage.setItem('ptj_e2e_instruments_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('the instrument catalog', () => {
  test('ships every futures complex a trader records', async ({ page }) => {
    await gotoSettings(page);

    for (const symbol of ['ES', 'MES', 'NQ', 'MNQ', 'CL', 'GC', 'ZN', '6E', 'BTC']) {
      await expect(page.locator(`[data-instrument-row="${symbol.toLowerCase()}"]`)).toBeVisible();
    }

    // The licence travels with the software, not only in the store listing.
    const terms = page.locator('#licence-terms');
    await expect(terms).toBeVisible();
    await expect(terms).toContainText('not a hosted service');
    await expect(terms).toContainText('may not resell');
  });

  test('adds a stock and records it in shares at one dollar a point', async ({ page }) => {
    await gotoSettings(page);

    await page.locator('#instrument-add-open').click();
    await page.locator('#instrument-add-kind-stock').click();
    await page.locator('#instrument-add-symbol').fill('aapl');
    await page.locator('#instrument-add-name').fill('Apple');
    await page.locator('#instrument-add-save').click();

    const row = page.locator('[data-instrument-row="aapl"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('AAPL');
    await expect(row).toContainText('$1/pt');
    await expect(page.locator('#instrument-manager-notice')).toContainText('AAPL added');

    // It survives a reload, so it is in storage rather than only in the form's state.
    await page.reload();
    await gotoSettings(page);
    await expect(page.locator('[data-instrument-row="aapl"]')).toBeVisible();
  });

  test('corrects a contract specification and derives the tick value', async ({ page }) => {
    await gotoSettings(page);

    await page.locator('#instrument-mes-edit').click();
    await page.locator('#instrument-mes-point-value').fill('6');
    await page.locator('#instrument-mes-save').click();

    const row = page.locator('[data-instrument-row="mes"]');
    await expect(row).toContainText('$6/pt');
    // 6 dollars a point x 0.25 tick = $1.50, computed rather than typed.
    await expect(row).toContainText('$1.5/tick');
  });

  test('removes a custom instrument without touching the catalog it ships with', async ({ page }) => {
    await gotoSettings(page);

    await page.locator('#instrument-add-open').click();
    await page.locator('#instrument-add-symbol').fill('zzz');
    await page.locator('#instrument-add-name').fill('Test contract');
    await page.locator('#instrument-add-save').click();
    await expect(page.locator('[data-instrument-row="zzz"]')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#instrument-zzz-delete').click();

    await expect(page.locator('[data-instrument-row="zzz"]')).toHaveCount(0);
    await expect(page.locator('[data-instrument-row="mes"]')).toBeVisible();
  });
});

test.describe('a stock trade prices itself', () => {
  test('one dollar a point per share, so 100 shares and 5 points is $500', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#instrument-add-open').click();
    await page.locator('#instrument-add-kind-stock').click();
    await page.locator('#instrument-add-symbol').fill('aapl');
    await page.locator('#instrument-add-name').fill('Apple');
    await page.locator('#instrument-add-save').click();
    await expect(page.locator('[data-instrument-row="aapl"]')).toBeVisible();

    // The add-trade button lives on Today, so leave Settings for the tab it belongs to.
    const todayTab = page.locator('#nav-btn-today');
    if (await todayTab.isVisible()) await todayTab.click();
    else await page.locator('#mobile-nav-today').click();

    await page.locator('#btn-add-trade-top').click();
    await expect(page.getByRole('heading', { name: /Log a Trade/i })).toBeVisible();

    const options = page.locator('#trade-more-options-toggle');
    if ((await options.getAttribute('aria-expanded')) === 'false') await options.click();

    await page.locator('#trade-instrument-select').selectOption('aapl');
    await page.locator('#trade-entry-price').fill('200');
    await page.locator('#trade-initial-stop').fill('195');
    await page.locator('#trade-contracts').fill('100');
    await page.locator('#trade-exit-price').fill('205');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    // Sized in shares, not contracts, and priced at the stock's own $1/point.
    await expect(page.getByText('AAPL (100x)')).toBeVisible();
    await expect(page.locator('#today-trades').getByText('+$500.00').first()).toBeVisible();
  });
});

test.describe('the in-app guide', () => {
  test('opens on the screen it was opened from', async ({ page }) => {
    await page.locator('#feature-guide-btn').click();

    const panel = page.locator('#feature-guide');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Today/i })).toBeVisible();
    await expect(panel).toContainText('How to use it');
    await expect(panel).toContainText('Add Trade');
  });

  test('moves between features without losing the panel', async ({ page }) => {
    await page.locator('#feature-guide-btn').click();
    await page.locator('#feature-guide-topic-settings').click();

    await expect(page.locator('#feature-guide')).toContainText('make the software yours');
    await expect(page.locator('#feature-guide')).toContainText('Instruments');

    await page.locator('#feature-guide-topic-memory').click();
    // The screens that need bought-and-configured services say so.
    await expect(page.locator('#feature-guide')).toContainText('services you supply');
    await expect(page.locator('#feature-guide')).toContainText('Gemini API key');
  });

  test('closes on Escape', async ({ page }) => {
    await page.locator('#feature-guide-btn').click();
    await expect(page.locator('#feature-guide')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#feature-guide')).toHaveCount(0);
  });
});

test.describe('a clean first run', () => {
  test('has no trades and no sample levels', async ({ page }) => {
    const stored = await page.evaluate(() => ({
      trades: localStorage.getItem('ptj_trades_v1'),
      levels: localStorage.getItem('ptj_mes_levels_v1'),
      days: JSON.parse(localStorage.getItem('ptj_days_v1') ?? '[]') as unknown[],
    }));

    expect(stored.trades === null || stored.trades === '[]').toBe(true);
    expect(stored.levels === null || stored.levels === '[]').toBe(true);
    // One empty day is created so the app has somewhere to land; it holds no trade.
    expect(stored.days.length).toBeLessThanOrEqual(1);

    const desktop = page.locator('#nav-btn-mes');
    if (await desktop.isVisible()) await desktop.click();
    else await page.locator('#mobile-nav-mes').click();

    await expect(page.getByText(/0 levels logged/)).toBeVisible();
  });
});
