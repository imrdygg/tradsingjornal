import { expect, test, type Page } from '@playwright/test';

/**
 * Regression tests for the issues reported against the Playbook and the mobile layout:
 *
 *  1. Recording a trade used to make the trader pick a setup out of a menu. It now asks
 *     one question — which of the two sides was it — and the answer is stored as given.
 *  2. Setup names were visually cut off on the Playbook cards.
 *  3. The bottom navigation disappeared under the browser's own bars while
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

test.describe('Position badges on the trade list', () => {
  test('a standalone trade is not badged as a position', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    await expect(page.getByText(/Combined position/)).toHaveCount(0);
  });
});
