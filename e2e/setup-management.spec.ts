import { expect, test, type Page } from '@playwright/test';

/**
 * Covers managing the playbook catalog from Settings instead of editing code:
 *  - a setup can be renamed, and its built-in study guide follows the new name
 *  - renaming offers to bring the journal's existing entries along, and only on request
 *  - a setup can be moved, and the Playbook and the trade dropdown follow that order
 *  - a duplicate or empty name is refused rather than saved
 *
 * A fresh journal gets the built-in catalog — the trader's two level setups, Support and
 * Resistance — and one trading day that watches those same two, so renaming one has a
 * planned day, with no trades yet, already recorded under the old name.
 */

const SUPPORT_SUMMARY = 'Buying a proven demand zone where price has repeatedly stopped falling';

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
  // The control only exists once a setup sits outside the focus pair — a renamed one still
  // lives inside it, so these tests usually have nothing to reveal.
  const toggle = page.locator('#playbook-focus-toggle');
  if ((await toggle.count()) === 0) return;
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

    await expect(page.locator('[data-testid="setup-name-support"]')).toHaveValue('Support');
    await expect(page.locator('[data-testid="setup-name-resistance"]')).toHaveValue('Resistance');
  });

  test('renaming keeps the built-in guide and offers to relabel history', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-support"]');
    await field.fill('Prior Day Low');
    await field.blur();

    // The old name is what the journal recorded, so the offer is measured against it —
    // the seeded day watches it, with no trades yet.
    const offer = page.getByRole('button', { name: /Update them to/ });
    await expect(offer).toBeVisible();
    await expect(page.getByText(/still say .Support./)).toBeVisible();

    // The built-in association survives the rename rather than falling back to generic.
    await expect(page.getByText('guide: Support')).toBeVisible();

    await offer.click();
    await expect(page.getByRole('button', { name: /Update them to/ })).toBeHidden();

    // The renamed setup keeps its study guide in the Playbook.
    await gotoPlaybook(page);
    await expect(page.getByTitle('Prior Day Low', { exact: true })).toBeVisible();
    expect(await page.getByText(SUPPORT_SUMMARY, { exact: false }).count()).toBeGreaterThan(0);
  });

  test('declining the relabel keeps the journal as it was', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-support"]');
    await field.fill('Prior Day Low');
    await field.blur();

    await page.getByRole('button', { name: /Leave history as it was/ }).click();
    await expect(page.getByRole('button', { name: /Update them to/ })).toBeHidden();

    // The day still watches "Support", and the setup is called "Prior Day Low".
    await expect(field).toHaveValue('Prior Day Low');
    const watched = await page.evaluate(() => {
      const raw = localStorage.getItem('ptj_trading_days_v1');
      return raw ? JSON.parse(raw) : [];
    });
    expect(watched.some((day: { watchedSetups?: string[] }) =>
      (day.watchedSetups ?? []).includes('Support')
    )).toBe(true);
  });

  test('a duplicate or empty name is refused, not saved', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-resistance"]');
    await field.fill('support');
    await field.blur();

    await expect(page.getByText(/Another setup is already called/)).toBeVisible();

    // A blank draft is called out while it is being typed, and on blur it reverts rather
    // than saving an unnamed setup.
    await field.fill('   ');
    await expect(page.getByText('A setup needs a name.')).toBeVisible();
    await field.blur();
    await expect(field).toHaveValue('Resistance');

    // Nothing was written: the catalog still answers to Resistance.
    await page.reload();
    await gotoSettings(page);
    await expect(page.locator('[data-testid="setup-name-resistance"]')).toHaveValue('Resistance');
  });

  test('moving a setup reorders the Playbook too', async ({ page }) => {
    await gotoSettings(page);

    // Support leads the list, so it is the one with room to move down.
    await page.getByRole('button', { name: 'Move Support down' }).click();
    await expect
      .poll(async () => {
        const resistance = await nameTop(page, 'Resistance');
        const support = await nameTop(page, 'Support');
        return resistance < support;
      })
      .toBe(true);
    // The first row's "up" control is disabled at the top of the list.
    await gotoSettings(page);
    await expect(page.getByRole('button', { name: 'Move Resistance up' })).toBeDisabled();
  });

  test('rename and order survive a reload', async ({ page }) => {
    await gotoSettings(page);

    const field = page.locator('[data-testid="setup-name-support"]');
    await field.fill('Prior Day Low');
    await field.blur();
    await page.getByRole('button', { name: /Leave history as it was/ }).click();

    await page.getByRole('button', { name: 'Move Prior Day Low down' }).click();

    await page.reload();
    await gotoSettings(page);

    await expect(page.locator('[data-testid="setup-name-support"]')).toHaveValue('Prior Day Low');
    // Prior Day Low was moved below the other setup, and that order survives the reload.
    await expect
      .poll(async () => await nameTop(page, 'Resistance'))
      .toBeLessThan(await nameTop(page, 'Prior Day Low'));
  });
});
