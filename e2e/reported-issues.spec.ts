import { expect, test, type Page } from '@playwright/test';

/**
 * Regression tests for the issues reported against the Playbook, the position
 * scale-in calculator and the mobile layout:
 *
 *  1. Recording a trade used to make the trader pick a setup out of a menu. It now asks
 *     one question — which of the two sides was it — and the answer is stored as given.
 *  2. Setup names were visually cut off on the Playbook cards.
 *  3. The break-even calculator shipped hard-coded example prices — it must
 *     auto-fill from the trader's real open trade instead.
 *  4. The bottom navigation disappeared under the browser's own bars while
 *     scrolling on a phone.
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
  await revealAllSetups(page);
}

/**
 * Reveals anything sitting outside the focus pair.
 *
 * A fresh journal's catalog is exactly that pair — Support and Resistance — so the control
 * is not rendered at all and there is nothing to do. It appears only once a setup has been
 * added or learned.
 */
async function revealAllSetups(page: Page) {
  const toggle = page.locator('#playbook-focus-toggle');
  if ((await toggle.count()) === 0) return;
  if ((await toggle.textContent())?.includes('Show all setups')) await toggle.click();
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

/**
 * The Today tab opens on the review, the trend, the search box and the day's trades: the
 * morning plan, the risk summary and the drawdown strip sit behind one folded section.
 */
async function expandTodayAdvanced(page: Page) {
  // Addressed by the body it controls, not by aria-expanded: the section holds other
  // collapsibles, so "any collapsed button inside it" is not the section's own toggle.
  const toggle = page.locator('button[aria-controls="section-today-advanced-body"]').first();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

async function openAddTrade(page: Page) {
  await page.locator('#btn-add-trade-top').click();
  await expect(
    page.getByRole('heading', { name: /Log a Trade/i })
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

test.describe('Recording a trade asks which side, not which setup', () => {
  test('offers Support and Resistance as buttons, and no menu', async ({ page }) => {
    await openAddTrade(page);

    const support = page.locator('#trade-setup-support');
    const resistance = page.locator('#trade-setup-resistance');
    await expect(support).toBeVisible();
    await expect(resistance).toBeVisible();

    // Support leads, so it is what an untouched form records.
    await expect(support).toHaveAttribute('aria-pressed', 'true');
    await expect(resistance).toHaveAttribute('aria-pressed', 'false');

    await resistance.click();
    await expect(resistance).toHaveAttribute('aria-pressed', 'true');
    await expect(support).toHaveAttribute('aria-pressed', 'false');

    // The picker is gone for good: a list of every catalog name is exactly the menu this
    // replaced, and re-adding one would put the choice back in the way of the trade.
    await expect(page.locator('#trade-setup-select')).toHaveCount(0);
  });

  test('stores the side that was pressed', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-setup-resistance').click();
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.locator('#trade-exit-price').fill('7740');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();
    await expect(page.getByRole('heading', { name: /Log a Trade/i })).toHaveCount(0);

    // Read the stored record rather than the card, so this is the saved setup and not a
    // badge the card happens to render.
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('ptj_trades_v1');
      const trades = raw ? (JSON.parse(raw) as Array<{ setupName?: string }>) : [];
      return trades.map((trade) => trade.setupName);
    });
    expect(stored).toContain('Resistance');
  });

  test('a setup added by hand is not silently picked for the trade', async ({ page }) => {
    await gotoPlaybook(page);
    await page.getByPlaceholder(/Fair Value Gap/).fill('VWAP Reclaim');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // Two buttons and nothing more, even with a third setup in the catalog: the catalog is
    // where a setup is studied, and the form is where the side of the level is recorded.
    await gotoTab(page, 'today', /^Today$/);
    await openAddTrade(page);

    await expect(page.locator('#trade-setup-support')).toBeVisible();
    await expect(page.locator('#trade-setup-resistance')).toBeVisible();
    await expect(page.getByText('VWAP Reclaim')).toHaveCount(0);
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

/**
 * The bottom nav used to be a `position: fixed; bottom: 0` overlay, which tracks the
 * layout viewport rather than the visible one. On a phone that puts it underneath the
 * browser's URL bar as that collapses and expands during a scroll — the bar is there, and
 * then it is not. The shell now owns the only scroll region, so the nav is simply part of
 * the column and cannot move. These assertions pin that structure, not just the pixels.
 */
test.describe('The bottom nav stays on screen while the page scrolls', () => {
  test('keeps its place, and the document itself never scrolls', async ({ page }) => {
    // The Playbook is the longest surface, so it guarantees something to scroll.
    await gotoPlaybook(page);

    const nav = page.locator('#mobile-nav');
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!(await nav.isVisible())) test.skip(true, 'The desktop layout has no bottom bar.');

    const before = await nav.boundingBox();
    expect(before).not.toBeNull();
    // On screen to begin with, and not hanging off the bottom edge.
    expect(before!.y).toBeGreaterThan(0);
    expect(before!.y + before!.height).toBeLessThanOrEqual(viewport!.height + 1);

    const scrolled = await page.locator('main').evaluate(async (el) => {
      el.scrollTop = el.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      return el.scrollTop;
    });
    // If nothing scrolled the rest of this test would pass for the wrong reason.
    expect(scrolled).toBeGreaterThan(0);

    const after = await nav.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
    expect(after!.y + after!.height).toBeLessThanOrEqual(viewport!.height + 1);

    // The window must not be the scroller. That is the whole fix: a fixed bar moves with
    // the layout viewport, whereas a row in a shell that owns the scroll cannot move at all.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
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

    // The scale-in calculator lives in the folded section with the rest of the plan.
    await expandTodayAdvanced(page);

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
    await expandTodayAdvanced(page);

    // The calculator is opt-in now, so it is opened before it can be inspected.
    await page.locator('#toggle-scale-in').click();
    await expect(page.getByText(/Your Example \(1 @ 7730/i)).toHaveCount(0);
    await expect(page.getByText(/Down \$50 Example/i)).toHaveCount(0);
  });

  test('scaling in is optional: the calculator is folded away until it is asked for', async ({
    page,
  }) => {
    await expandTodayAdvanced(page);

    // With no open position there is nothing to add to, so the step stays collapsed and
    // nothing about it is required before locking.
    await expect(page.locator('#toggle-scale-in')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#breakeven-entry-price')).toHaveCount(0);

    await page.locator('#toggle-scale-in').click();
    await expect(page.locator('#toggle-scale-in')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#breakeven-entry-price')).toBeVisible();

    // And it folds away again, so the plan is never carrying a step it does not use.
    await page.locator('#toggle-scale-in').click();
    await expect(page.locator('#breakeven-entry-price')).toHaveCount(0);
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
    await expandTodayAdvanced(page);

    // Describe the add: 5 more contracts at 7700 with price now at 7700.
    await page.locator('#breakeven-current-price').fill('7700');
    await page.locator('#breakeven-add-price').fill('7700');
    await page.locator('#breakeven-contracts-to-add').fill('5');

    // New average must be 7705 -> a 5 point bounce from the add.
    await expect(page.getByText('7,705.00').first()).toBeVisible();

    await page.locator('#breakeven-log-scale-in').click();

    // The record form opens as a NEW trade, pre-filled with the add.
    await expect(page.getByRole('heading', { name: /Log a Trade/i })).toBeVisible();
    await expect(page.getByText(/Pre-filled from the break-even calculator/i)).toBeVisible();
    await expect(page.locator('#trade-entry-price')).toHaveValue('7700');
    await expect(page.locator('#trade-contracts')).toHaveValue('5');

    // The add arrives with a plan stop for its own entry and size; the trader overrides it
    // here with the level the position is actually wrong at.
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
    await expandTodayAdvanced(page);

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
    await expandTodayAdvanced(page);

    // No open trade, so the optional calculator is folded away until it is opened.
    await page.locator('#toggle-scale-in').click();

    // No open trade and no manual entry yet.
    await expect(page.locator('#breakeven-log-scale-in')).toBeDisabled();

    await page.locator('#breakeven-entry-price').fill('7730');
    await page.locator('#breakeven-add-price').fill('7700');
    await expect(page.locator('#breakeven-log-scale-in')).toBeEnabled();
  });
});
