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
  test('the review, the trend and the search box are open without unfolding anything', async ({
    page,
  }) => {
    await expect(page.locator('#section-eod-review-body')).toBeVisible();
    await expect(page.locator('#latest-review')).toBeVisible();
    await expect(page.locator('#latest-review')).toContainText('no review written yet');
    await expect(page.locator('#section-review-trend-body')).toBeVisible();
    await expect(page.locator('#journal-search')).toBeVisible();

    // Still folded: the plan and the risk panels are not on screen until asked for.
    await expect(
      page.locator('button[aria-controls="section-today-advanced-body"]').first()
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#drawdown-room')).toBeHidden();
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
