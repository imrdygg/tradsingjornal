import { expect, test, type Page } from '@playwright/test';

/**
 * Covers managing the playbook catalog from Settings instead of editing code:
 *  - a setup can be renamed, and its built-in study guide follows the new name
 *  - renaming offers to bring the journal's existing entries along, and only on request
 *  - a setup can be moved, and the Playbook and the trade dropdown follow that order
 *  - a duplicate or empty name is refused rather than saved
 *
 * A fresh journal gets the built-in catalog and one trading day whose watchedSetups are the
 * two break-and-run setups the app is built around, so renaming one of those has a planned
 * day — but no trades — already recorded under the old name.
 */

const OVERNIGHT_SUMMARY = 'The overnight session breaks a level and never looks back';

/** Open a tab via whichever nav is visible at the current viewport. */
async function gotoTab(page: Page, tab: string) {
  const desktop = page.locator(`#nav-btn-${tab}`);
  const mobile = page.locator(`#mobile-nav-${tab}`);
  if (await desktop.isVisible()) await desktop.click();
  else await mobile.click();
}

async function gotoSettings(page: Page) {
  // Settings lives in the avatar menu, not the tab bars.
  await page.locator('#account-menu-btn').click();
  await page.locator('#account-menu-settings-btn').click();
  await expect(page.getByText('Playbook Setups — Rename & Order')).toBeVisible();
}

async function gotoPlaybook(page: Page) {
  await gotoTab(page, 'playbook');
  await expect(page.getByRole('heading', { name: /Trading Setups & Playbook Library/i })).toBeVisible();
  // The library opens trimmed to the two focus setups; these assertions are about the
  // whole catalog, including setups renamed away from the focus pair.
  const toggle = page.locator('#playbook-focus-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.textContent())?.includes('Show all setups')) await toggle.click();
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

    const field = page.locator('[data-testid="setup-name-overnight-break-and-run"]');
    await field.fill('Body Swap');
    await field.blur();

    // The old name is what the journal recorded, so the offer is measured against it —
    // the seeded day watches it, with no trades yet.
    const offer = page.getByRole('button', { name: /Update them to/ });
    await expect(offer).toBeVisible();
    await expect(page.getByText(/still say .Overnight Break & Run./)).toBeVisible();

    // The built-in association survives the rename rather than falling back to generic.
    await expect(page.getByText('guide: Overnight Break & Run')).toBeVisible();

    await offer.click();
    await expect(page.getByRole('button', { name: /Update them to/ })).toBeHidden();

    // The renamed setup keeps its study guide in the Playbook.
    await gotoPlaybook(page);
    await expect(page.getByTitle('Body Swap', { exact: true })).toBeVisible();
    expect(await page.getByText(OVERNIGHT_SUMMARY).count()).toBeGreaterThan(0);
  });

  test('declining the relabel keeps the journal as it was', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-overnight-break-and-run"]');
    await field.fill('Body Swap');
    await field.blur();

    await page.getByRole('button', { name: /Leave history as it was/ }).click();
    await expect(page.getByRole('button', { name: /Update them to/ })).toBeHidden();

    // The day still watches "Overnight Break & Run", and the setup is called "Body Swap".
    await expect(field).toHaveValue('Body Swap');
    const watched = await page.evaluate(() => {
      const raw = localStorage.getItem('ptj_trading_days_v1');
      return raw ? JSON.parse(raw) : [];
    });
    expect(watched.some((day: { watchedSetups?: string[] }) =>
      (day.watchedSetups ?? []).includes('Overnight Break & Run')
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
    // The first row's "up" control is disabled at the top of the list. The two focus
    // setups lead the catalog, so the top row is the first of those.
    await gotoSettings(page);
    await expect(
      page.getByRole('button', { name: 'Move Overnight Break & Run up' })
    ).toBeDisabled();
  });

  test('rename and order survive a reload', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-overnight-break-and-run"]');
    await field.fill('Body Swap');
    await field.blur();
    await page.getByRole('button', { name: /Leave history as it was/ }).click();

    await page.getByRole('button', { name: 'Move Body Swap down' }).click();

    await page.reload();
    await gotoSettings(page);

    await expect(page.locator('[data-testid="setup-name-overnight-break-and-run"]')).toHaveValue('Body Swap');
    // Body Swap was moved below the other focus setup, and that order survives the reload.
    await expect
      .poll(async () => await nameTop(page, 'Session Break & Run'))
      .toBeLessThan(await nameTop(page, 'Body Swap'));
  });
});
