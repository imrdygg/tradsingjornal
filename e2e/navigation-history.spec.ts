import { expect, test, type Page } from '@playwright/test';

/**
 * Where the day archive lives, and the shape of the bar that reaches it.
 *
 * History used to be the second item inside the avatar menu because the tab row was a fixed
 * nine-column grid with no room left. The row scrolls now, so History is a tab on both bars,
 * and the avatar menu is back to being about the account. These tests pin the move and the
 * three things that had to change for it: a wider row, a larger icon, and a row that can be
 * swiped instead of squeezed.
 */

async function gotoHistory(page: Page) {
  const desktop = page.locator('#nav-btn-history');
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    const mobile = page.locator('#mobile-nav-history');
    // The row scrolls, so the tab is not necessarily in the initial viewport.
    await mobile.scrollIntoViewIfNeeded();
    await mobile.click();
  }
  await expect(page.getByRole('heading', { name: 'Trading Day History' })).toBeVisible();
}

test('History is a tab on both bars, not an item behind the avatar', async ({ page }) => {
  await page.goto('/');

  const desktop = page.locator('#nav-btn-history');
  const mobile = page.locator('#mobile-nav-history');
  // Exactly one is on screen at any width, and both exist in the DOM.
  await expect(desktop.or(mobile).filter({ visible: true })).toHaveCount(1);

  await gotoHistory(page);

  // The avatar menu still holds the account and Settings — and no longer a second History.
  if (await page.locator('#account-menu-btn').isVisible()) {
    await page.locator('#account-menu-btn').click();
    await expect(page.locator('#account-menu-settings-btn')).toBeVisible();
    await expect(page.locator('#account-menu-history-btn')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('the bottom bar scrolls sideways and carries ten tabs', async ({ page }) => {
  await page.goto('/');

  const row = page.locator('#mobile-nav-row');
  if (!(await row.isVisible())) test.skip(true, 'The desktop layout has no bottom bar.');

  await expect(page.locator('#mobile-nav [role="tab"]')).toHaveCount(10);

  const metrics = await row.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  // A swipeable row, not a grid: the tabs are wider than the screen on purpose.
  expect(metrics.overflowX).toBe('auto');
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

  await row.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test('the bottom bar icons are large enough to tap and read', async ({ page }) => {
  await page.goto('/');

  const row = page.locator('#mobile-nav-row');
  if (!(await row.isVisible())) test.skip(true, 'The desktop layout has no bottom bar.');

  // 16px was what the old nine-column grid could afford. The row scrolls, so nothing forces
  // the icons back down to that size.
  const smallest = await row.locator('[role="tab"] svg').evaluateAll((icons) =>
    Math.min(...icons.map((icon) => icon.getBoundingClientRect().width))
  );
  expect(smallest).toBeGreaterThanOrEqual(20);
});
