import { expect, test, type Page } from '@playwright/test';

/**
 * Covers managing the playbook catalog from Settings instead of editing code:
 *  - a setup can be renamed, and its built-in study guide follows the new name
 *  - renaming offers to bring the journal's existing entries along, and only on request
 *  - a setup can be moved, and the Playbook and the trade dropdown follow that order
 *  - a duplicate or empty name is refused rather than saved
 *
 * A fresh journal gets the built-in catalog and one trading day whose watchedSetups are
 * ['Engulfing', 'Support', 'Resistance'], so renaming Engulfing has days — but no trades —
 * already recorded under the old name.
 */

const ENGULFING_SUMMARY =
  'A two-candle reversal pattern where one candle fully "swallows" the body of the previous one';

/** Open a tab via whichever nav is visible at the current viewport. */
async function gotoTab(page: Page, tab: string) {
  const desktop = page.locator(`#nav-btn-${tab}`);
  const mobile = page.locator(`#mobile-nav-${tab}`);
  if (await desktop.isVisible()) await desktop.click();
  else await mobile.click();
}

async function gotoSettings(page: Page) {
  await gotoTab(page, 'settings');
  await expect(page.getByText('Playbook Setups — Rename & Order')).toBeVisible();
}

async function gotoPlaybook(page: Page) {
  await gotoTab(page, 'playbook');
  await expect(page.getByRole('heading', { name: /Trading Setups & Playbook Library/i })).toBeVisible();
}

/** The vertical position of a setup's name in the Playbook, for order assertions. */
async function nameTop(page: Page, name: string): Promise<number> {
  await gotoPlaybook(page);
  const box = await page.getByTitle(name, { exact: true }).first().boundingBox();
  return box?.y ?? Number.NaN;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ptj_e2e_cleared')) return;
    sessionStorage.setItem('ptj_e2e_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Playbook setups in Settings', () => {
  test('lists every setup with its own rename field', async ({ page }) => {
    await gotoSettings(page);

    await expect(page.locator('[data-testid="setup-name-engulfing"]')).toHaveValue('Engulfing');
    await expect(page.locator('[data-testid="setup-name-support"]')).toHaveValue('Support');
    await expect(page.locator('[data-testid="setup-name-resistance"]')).toHaveValue('Resistance');
  });

  test('renaming keeps the built-in guide and offers to relabel history', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-engulfing"]');
    await field.fill('Body Swap');
    await field.blur();

    // The old name is what the journal recorded, so the offer is measured against it —
    // one planned day, no trades.
    const offer = page.getByRole('button', { name: /Update them to/ });
    await expect(offer).toBeVisible();
    await expect(page.getByText(/still say .Engulfing./)).toBeVisible();

    // The built-in association survives the rename rather than falling back to generic.
    await expect(page.getByText('guide: Engulfing')).toBeVisible();

    await offer.click();
    await expect(page.getByRole('button', { name: /Update them to/ })).toBeHidden();

    // The renamed setup keeps its study guide in the Playbook.
    await gotoPlaybook(page);
    await expect(page.getByTitle('Body Swap', { exact: true })).toBeVisible();
    expect(await page.getByText(ENGULFING_SUMMARY).count()).toBeGreaterThan(0);
  });

  test('declining the relabel keeps the journal as it was', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-engulfing"]');
    await field.fill('Body Swap');
    await field.blur();

    await page.getByRole('button', { name: /Leave history as it was/ }).click();
    await expect(page.getByRole('button', { name: /Update them to/ })).toBeHidden();

    // The day still watches "Engulfing", and the setup is still called "Body Swap".
    await expect(field).toHaveValue('Body Swap');
    const watched = await page.evaluate(() => {
      const raw = localStorage.getItem('ptj_trading_days_v1');
      return raw ? JSON.parse(raw) : [];
    });
    expect(watched.some((day: { watchedSetups?: string[] }) =>
      (day.watchedSetups ?? []).includes('Engulfing')
    )).toBe(true);
  });

  test('a duplicate or empty name is refused, not saved', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-engulfing"]');
    await field.fill('support');
    await field.blur();

    await expect(page.getByText(/Another setup is already called/)).toBeVisible();

    // A blank draft is called out while it is being typed, and on blur it reverts rather
    // than saving an unnamed setup.
    await field.fill('   ');
    await expect(page.getByText('A setup needs a name.')).toBeVisible();
    await field.blur();
    await expect(field).toHaveValue('Engulfing');

    // Nothing was written: the catalog still answers to Engulfing.
    await page.reload();
    await gotoSettings(page);
    await expect(page.locator('[data-testid="setup-name-engulfing"]')).toHaveValue('Engulfing');
  });

  test('moving a setup reorders the Playbook too', async ({ page }) => {
    await gotoSettings(page);

    await page.getByRole('button', { name: 'Move Engulfing down' }).click();
    await expect
      .poll(async () => await nameTop(page, 'Support'))
      .toBeLessThan(await nameTop(page, 'Engulfing'));
    // The first row's "up" control is disabled at the top of the list.
    await gotoSettings(page);
    await expect(page.getByRole('button', { name: 'Move Support up' })).toBeDisabled();
  });

  test('rename and order survive a reload', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-engulfing"]');
    await field.fill('Body Swap');
    await field.blur();
    await page.getByRole('button', { name: /Leave history as it was/ }).click();

    await page.getByRole('button', { name: 'Move Body Swap down' }).click();

    await page.reload();
    await gotoSettings(page);

    await expect(page.locator('[data-testid="setup-name-engulfing"]')).toHaveValue('Body Swap');
    await expect
      .poll(async () => await nameTop(page, 'Support'))
      .toBeLessThan(await nameTop(page, 'Body Swap'));
  });
});
