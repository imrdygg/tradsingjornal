import { expect, test } from '@playwright/test';

/**
 * Covers the two daily coach checkpoints on the Today tab:
 *  - the card is present without navigating, and names the active checkpoint
 *  - the trader can switch to the other checkpoint and back
 *  - nothing is requested until asked, and a failure leaves a way to retry
 *
 * Which checkpoint is auto-selected depends on the wall clock, so these specs never
 * assert one specific checkpoint. The window boundaries themselves are covered by
 * unit tests in src/lib/ai/__tests__/checkpoints.test.ts, where the clock can be fixed.
 */

const ANY_CHECKPOINT = /Pre-session prep|Post-session review/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Coach checkpoints on Today', () => {
  test('appears on the Today tab without navigating, naming the active checkpoint', async ({
    page,
  }) => {
    await expect(page.locator('#coach-checkpoint-card')).toBeVisible();
    await expect(page.locator('#coach-checkpoint-label')).toHaveText(ANY_CHECKPOINT);
    await expect(page.locator('#coach-checkpoint-evidence')).toBeVisible();
  });

  test('states that it reads only the journal, with no market data', async ({ page }) => {
    await expect(
      page.getByText(/Reads only your journal — no market data or predictions/i)
    ).toBeVisible();
  });

  test('reports the window so the schedule is never a mystery', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');

    // The header chip shows the active window...
    await expect(card.getByText(/(08:00–16:00|16:00–08:00)/).first()).toBeVisible();
    // ...and the schedule line states both boundaries.
    await expect(card.locator('#coach-checkpoint-schedule')).toContainText('08:00–16:00');
    await expect(card.locator('#coach-checkpoint-schedule')).toContainText('16:00–08:00');
    await expect(card.locator('#coach-checkpoint-schedule')).toContainText(/local time/i);
  });

  test('generates nothing on load, then reports honestly when the service is unavailable', async ({
    page,
  }) => {
    const card = page.locator('#coach-checkpoint-card');
    await expect(card).toBeVisible();

    // Nothing has been written before the trader asks.
    await expect(card.locator('#coach-checkpoint-result')).toHaveCount(0);
    await expect(card.locator('#coach-error-checkpoint')).toHaveCount(0);

    await card.locator('#coach-checkpoint-generate').click();

    // Ids follow the coach-error-* convention used by the Coach tab.
    const error = card.locator('#coach-error-checkpoint');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Coach not available here/i);
    await expect(card.locator('#coach-checkpoint-result')).toHaveCount(0);
  });

  test('leaves a retry available after a failed attempt', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');
    const button = card.locator('#coach-checkpoint-generate');

    await button.click();
    await expect(card.locator('#coach-error-checkpoint')).toBeVisible();

    // The button must survive the failure, relabelled, rather than leaving a dead end.
    await expect(button).toBeVisible();
    await expect(button).toHaveText(/Try again/i);
  });

  test('switches to the other checkpoint and back to the current one', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');
    const label = card.locator('#coach-checkpoint-label');
    const switcher = card.locator('#coach-checkpoint-switch');

    await expect(label).toHaveText(ANY_CHECKPOINT);
    const active = (await label.textContent())?.trim() ?? '';
    const other = active === 'Pre-session prep' ? 'Post-session review' : 'Pre-session prep';

    await switcher.click();
    await expect(label).toHaveText(other);
    await expect(switcher).toHaveText(/Back to now/i);
    // The action button follows the switched checkpoint.
    await expect(card.locator('#coach-checkpoint-generate')).toBeVisible();

    await switcher.click();
    await expect(label).toHaveText(active);
  });

  test('shows the evidence grade from the journal without any AI call', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');

    // An empty journal is honestly labelled as thin evidence, computed locally.
    await expect(card.locator('#coach-checkpoint-evidence')).toHaveText(/Thin evidence/i);
    await expect(card.getByText(/0 closed/)).toBeVisible();
    await expect(card.getByText(/0 reviewed/)).toBeVisible();
  });
});
