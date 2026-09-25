import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the numbered risk plan:
 *  - a trade can be recorded against a chosen slot instead of a free-typed risk
 *  - the plan's per-slot cap is flagged on the Today summary once a slot is spent
 *  - a slot with no cap set never flags, because there is nothing to break
 *
 * A fresh journal starts with the default ladder ($25/$50/$75/$100), trade #1 selected, and
 * no caps — so a flag only ever appears because the test set one.
 */

/**
 * The Today tab opens on the day's trades alone: the plan, the risk summary that carries
 * the cap flags, and the coach panels are behind one folded section.
 */
async function expandTodayAdvanced(page: Page) {
  // Addressed by the body it controls, not by aria-expanded: the section holds other
  // collapsibles, so "any collapsed button inside it" is not the section's own toggle.
  const toggle = page.locator('button[aria-controls="section-today-advanced-body"]').first();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

/** The risk ladder is one of the form's optional fields, so it is unfolded first. */
async function expandTradeOptions(page: Page) {
  const toggle = page.locator('#trade-more-options-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

async function openAddTrade(page: Page) {
  await page.locator('#btn-add-trade-top').click();
  await expect(page.getByRole('heading', { name: /Log a Trade/i })).toBeVisible();
}

/**
 * Records one open trade against a given slot.
 *
 * The contracts field is set by hand after the stop: the form derives a size from the slot,
 * and a test that let it would be asserting on the derivation rather than on the cap.
 */
async function recordTrade(page: Page, slot: number, entry = '7730', stop = '7710') {
  await openAddTrade(page);
  await expandTradeOptions(page);
  await page.locator(`[data-testid="trade-risk-tier-${slot}"]`).click();
  await page.locator('#trade-entry-price').fill(entry);
  await page.locator('#trade-initial-stop').fill(stop);
  await page.locator('#trade-contracts').fill('1');
  await page.getByRole('button', { name: /Save Open Trade/i }).click();
  await expect(page.getByRole('heading', { name: /Today's Trade Executions/i })).toBeVisible();
}

/** Sets a slot's cap in the Morning Plan. Committed on blur, like any other plan field. */
async function setCap(page: Page, slot: number, cap: number) {
  await expandTodayAdvanced(page);
  const input = page.locator(`[data-testid="tier-cap-${slot}"]`);
  await input.fill(String(cap));
  await input.blur();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Recording a trade against a risk slot', () => {
  test('the chosen Trade # is stored on the trade and shown on its card', async ({ page }) => {
    await recordTrade(page, 3);

    await expect(page.locator('[data-trade-risk-slot="3"]').first()).toBeVisible();
    // The default slot was #1, so a #3 card proves the picker was honoured.
    await expect(page.locator('[data-trade-risk-slot="1"]')).toHaveCount(0);
  });

  test('the custom option takes a free risk amount', async ({ page }) => {
    await openAddTrade(page);
    await expandTradeOptions(page);
    await page.locator('[data-testid="trade-risk-tier-custom"]').click();
    await page.locator('#trade-custom-risk').fill('40');
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    await expect(page.locator('[data-trade-risk-slot="custom"]').first()).toBeVisible();
    await expect(page.locator('[data-trade-risk-slot="custom"]').first()).toContainText('$40');
  });
});

test.describe('Slots whose cap the day has used up', () => {
  test('flags the slot as full when the day’s last trade fills it', async ({ page }) => {
    await setCap(page, 1, 1);

    // Nothing taken yet, so the slot is not yet spent.
    await expect(page.locator('[data-testid="cap-flag-1"]')).toHaveCount(0);

    await recordTrade(page, 1);

    await expandTodayAdvanced(page);
    const flag = page.locator('[data-testid="cap-flag-1"]');
    await expect(flag).toBeVisible();
    await expect(flag).toContainText('Trade #1 is full');
    await expect(flag).toContainText('1 of 1 taken');
    // The flag names the trade that just filled it.
    await expect(flag).toContainText('Your last trade filled it');
  });

  test('warns in rose once a slot has gone past its cap', async ({ page }) => {
    await setCap(page, 1, 1);
    await recordTrade(page, 1);

    // A second trade at the same slot breaks the plan rather than filling it.
    await recordTrade(page, 1, '7740', '7725');

    await expandTodayAdvanced(page);
    const flag = page.locator('[data-testid="cap-flag-1"]');
    await expect(flag).toBeVisible();
    await expect(flag).toHaveAttribute('data-cap-over', 'true');
    await expect(flag).toContainText('over its cap');
    await expect(flag).toContainText('2 taken against a plan of 1');
  });

  test('a slot with no cap set never flags', async ({ page }) => {
    await recordTrade(page, 2);

    await expect(page.locator('[data-testid="cap-flag-2"]')).toHaveCount(0);
  });

  test('a slot with room left does not flag', async ({ page }) => {
    await setCap(page, 1, 3);
    await recordTrade(page, 1);

    await expect(page.locator('[data-testid="cap-flag-1"]')).toHaveCount(0);
  });
});
