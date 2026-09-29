import { expect, test, type Page } from '@playwright/test';

/**
 * Covers what Today shows before anything is unfolded:
 *  - the end-of-day review, its trend and the search box are on the page as it opens
 *  - the review the trader last wrote is readable, not just remembered as a score
 *  - the trend is not held back until the carried-forward lesson is accepted
 *
 * All of it used to sit inside the folded "Plan, risk & coach" section, and the trend was
 * additionally gated behind the lesson banner, so a journal with a written review could open
 * on a page that showed none of it.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

/** Writes the day's review from the card on Today, the way the trader reaches it. */
async function writeReview(page: Page) {
  await page.locator('#latest-review-open').click();
  await expect(page.getByText(/Daily Reflections/i).first()).toBeVisible();

  await page.getByPlaceholder(/Waited patiently/).fill('Sat out the first five minutes.');
  await page.getByPlaceholder(/Moved initial stop/).fill('Sized up after the first winner.');
  await page
    .getByPlaceholder(/Honor original stop/)
    .fill('One contract until the first trade is closed.');
  await page.getByRole('button', { name: /Save Daily Review/i }).click();
}

test.describe('What Today shows on load', () => {
  test('the day, its trades and the room behind them, without unfolding anything', async ({
    page,
  }) => {
    await expect(page.locator('#section-today-summary-body')).toBeVisible();
    await expect(page.locator('#section-eod-review-body')).toBeVisible();
    await expect(page.locator('#latest-review')).toBeVisible();
    await expect(page.locator('#latest-review')).toContainText('no review written yet');
    await expect(page.locator('#section-review-trend-body')).toBeVisible();
    await expect(page.locator('#journal-search')).toBeVisible();

    // Nothing is folded shut any more: the drawdown room and its chart are on the page.
    await expect(page.locator('#drawdown-room')).toBeVisible();
    await expect(page.locator('#drawdown-room-chart')).toBeVisible();

    // The day reads in one order — the numbers, then the trades they came from, then the
    // room and the trend behind both. Today's trades are inside the first group, not
    // stranded past the long-run panels.
    const y = async (selector: string) => (await page.locator(selector).boundingBox())?.y ?? -1;
    const summary = await y('#section-today-summary');
    const trades = await y('#today-trades');
    const room = await y('#today-room-and-trend');
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(summary).toBeLessThan(trades);
    expect(trades).toBeLessThan(room);

    // And the morning plan is gone from the tab entirely: no bias to write, no plan to
    // lock, and no fold left holding either.
    await expect(page.getByRole('heading', { name: /Morning Plan/i })).toHaveCount(0);
    await expect(page.locator('#lock-plan-btn')).toHaveCount(0);
    await expect(
      page.locator('button[aria-controls="section-today-advanced-body"]')
    ).toHaveCount(0);
    await expect(page.getByText(/Plan, risk & coach/i)).toHaveCount(0);
  });

  test('the review just written is on the tab, with its focus', async ({ page }) => {
    await writeReview(page);

    const card = page.locator('#latest-review');
    await expect(card).toContainText('recorded for today');
    await expect(card).toContainText('Sat out the first five minutes.');
    await expect(card).toContainText('Sized up after the first winner.');
    await expect(card).toContainText('One contract until the first trade is closed.');

    // And the trend counts it, without the lesson banner having been accepted — there is no
    // banner for a day that is only now being completed.
    await expect(page.locator('#review-trend')).toContainText('1 reviewed day');
  });
});
