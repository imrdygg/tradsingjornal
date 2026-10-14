import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the desk routine on the real UI:
 *  - the card is on Today as the page opens, in its first, unticked state
 *  - the readiness boundary sits exactly on the critical steps, not on the whole list
 *  - a tick survives a reload, because the record is written through the day's own save path
 *  - the trade form's gate names the outstanding critical steps and never blocks the form
 *
 * The last one is the point of the whole feature: the routine is only worth keeping because a
 * trade can be recorded through it and compared against one that was prepared.
 */

/** The steps the routine refuses to call a day prepared without. See `routine-template.ts`. */
const CRITICAL_KEYS = [
  'premarket-state',
  'premarket-levels',
  'premarket-plan',
  'premarket-setups',
  'premarket-no-trade',
  'premarket-mechanics',
];

/** A step that is on the list but is not one of the gating ones. */
const NON_CRITICAL_KEY = 'premarket-context';

/**
 * A clean journal, cleared once rather than on every navigation.
 *
 * `addInitScript` runs again on every reload, so clearing through it wiped the very ticks a
 * reload test was trying to prove were kept. This clears after the first load and then
 * reloads, which leaves the seed data in place and every later navigation untouched.
 */
async function startFresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.reload();
  await expect(page.locator('[data-testid="routine-card"]')).toBeVisible();
}

/** Ticks the steps named, by their test id, the way the trader taps them. */
async function tick(page: Page, keys: string[]) {
  for (const key of keys) {
    await page.locator(`[data-testid="routine-step-${key}"]`).click();
  }
}

async function openTradeForm(page: Page) {
  await page.locator('#header-add-trade-btn').click();
  // The size row is always on the form as it opens, whatever is folded away below it.
  await expect(page.locator('#trade-contracts')).toBeVisible();
}

async function closeTradeForm(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#trade-contracts')).toBeHidden();
}

test.describe('The desk routine on Today', () => {
  test.beforeEach(async ({ page }) => {
    await startFresh(page);
  });

  test('opens unticked, and says what the critical steps are', async ({ page }) => {
    await expect(page.locator('#today-routine')).toBeVisible();
    await expect(page.locator('[data-testid="routine-card"]')).toHaveAttribute(
      'data-readiness',
      'not-started'
    );
    await expect(page.locator('[data-testid="routine-readiness"]')).toHaveText('Not started');
    await expect(page.locator('[data-testid="routine-progress"]')).toHaveText(/^0\/\d+ steps$/);

    // Every critical step is named in the gate line, so the trader is told what is missing
    // rather than only that something is.
    const gate = page.locator('[data-testid="routine-gate-line"]');
    await expect(gate).toContainText(/critical steps? outstanding/i);
    await expect(gate).toContainText('Am I fit to trade today?');
  });

  test('is not ready until the critical steps are done, then is', async ({ page }) => {
    await tick(page, [NON_CRITICAL_KEY, ...CRITICAL_KEYS.slice(0, -1)]);

    // Still missing one critical step, so the day is not prepared.
    await expect(page.locator('[data-testid="routine-card"]')).toHaveAttribute(
      'data-readiness',
      'preparing'
    );
    await expect(page.locator('[data-testid="routine-gate-line"]')).toContainText(
      /1 critical step outstanding/i
    );

    await tick(page, [CRITICAL_KEYS[CRITICAL_KEYS.length - 1]]);
    await expect(page.locator('[data-testid="routine-card"]')).toHaveAttribute(
      'data-readiness',
      'ready'
    );
    await expect(page.locator('[data-testid="routine-readiness"]')).toHaveText('Ready to trade');
    await expect(page.locator('[data-testid="routine-gate-line"]')).toContainText(
      /every critical step is done/i
    );
  });

  test('reads complete only once the whole list is ticked', async ({ page }) => {
    const steps = page.locator('button[data-testid^="routine-step-"]');
    const total = await steps.count();
    expect(total).toBeGreaterThan(0);

    for (let i = 0; i < total; i += 1) {
      await steps.nth(i).click();
    }

    await expect(page.locator('[data-testid="routine-card"]')).toHaveAttribute(
      'data-readiness',
      'complete'
    );
    await expect(page.locator('[data-testid="routine-progress"]')).toHaveText(
      new RegExp(`^${total}\\/${total} steps$`)
    );
  });

  test('keeps the ticks and the streak after a reload', async ({ page }) => {
    await tick(page, CRITICAL_KEYS);
    await page.reload();

    await expect(page.locator('[data-testid="routine-card"]')).toHaveAttribute(
      'data-readiness',
      'ready'
    );
    // The prepared streak is read from the same record, so a prepared day counts as one.
    await expect(page.locator('[data-testid="routine-streak"]')).toHaveText('1');
  });

  test('takes a note against the steps that were skipped', async ({ page }) => {
    await page.locator('[data-testid="routine-note"]').fill('Skipped the calendar check.');
    await page.reload();
    await expect(page.locator('[data-testid="routine-note"]')).toHaveValue(
      'Skipped the calendar check.'
    );
  });

  test('explains itself on request, including what it cannot claim', async ({ page }) => {
    const toggle = page.locator('[data-testid="routine-explain-toggle"]');
    const reasoning = page.locator('[data-testid="routine-explainer"]');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(reasoning).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(reasoning.first()).toBeVisible();
    await expect(page.getByText(/not a controlled experiment/i).first()).toBeVisible();
  });
});

test.describe('The pre-trade gate in the trade form', () => {
  test.beforeEach(async ({ page }) => {
    await startFresh(page);
  });

  test('warns, names the critical steps, and still lets the trade be recorded', async ({
    page,
  }) => {
    await openTradeForm(page);

    const warning = page.locator('[data-testid="routine-gate-warning"]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/routine has not been started today/i);
    await expect(warning).toContainText(/6 critical routine steps outstanding/i);
    await expect(warning).toContainText('Write the stay-out condition');
    await expect(warning).toContainText(/it is still recorded/i);

    // Not a wall: the form still saves.
    await expect(page.locator('#trade-contracts')).toBeEnabled();
  });

  test('reads as prepared once the critical steps are done', async ({ page }) => {
    await tick(page, CRITICAL_KEYS);

    await openTradeForm(page);
    await expect(page.locator('[data-testid="routine-gate-ok"]')).toBeVisible();
    await expect(page.locator('[data-testid="routine-gate-warning"]')).toHaveCount(0);
  });

  test('says plainly when the day has traded through an unfinished routine', async ({ page }) => {
    // One critical step left undone, so the gate must stay shut for the rest of the day.
    await tick(page, CRITICAL_KEYS.slice(0, -1));
    await closeTradeForm(page).catch(() => undefined);

    await openTradeForm(page);
    await expect(page.locator('[data-testid="routine-gate-warning"]')).toContainText(
      /1 critical routine step outstanding/i
    );
    await expect(page.locator('[data-testid="routine-gate-warning"]')).toContainText(
      'Check the plumbing'
    );
  });
});
