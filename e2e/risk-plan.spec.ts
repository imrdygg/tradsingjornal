import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the numbered risk plan: a trade can be recorded against a chosen slot instead of a
 * free-typed risk, and that slot travels with the record.
 *
 * A fresh journal starts with the default ladder ($25/$50/$75/$100) and trade #1 selected,
 * so a card showing another slot proves the picker was honoured.
 */

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
 * The contracts field is set by hand after the stop: the form fills both in from the slot,
 * and a test that let it would be asserting on the derivation rather than on the slot the
 * trade ends up carrying.
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
