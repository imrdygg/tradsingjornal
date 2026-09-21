import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the copy a sync sets aside, which is what replaced the "use the cloud copy / keep
 * this device's copy" prompt:
 *  - a normal journal shows nothing about sync copies at all
 *  - when a sync displaced a copy, Settings offers it for download and can discard it
 *
 * The suite boots without Supabase, so no sync actually runs here; the spec seeds the copy
 * the way `storage.saveRecoveryCopy` would have left it.
 */

const RECOVERY_KEY = 'ptj_recovery_v1';

/** The journal as it was when a sync moved it out of the way. */
const SET_ASIDE = JSON.stringify({
  json: JSON.stringify({ tradingDays: [{ id: 'day-1' }], trades: [{ id: 'trade-1' }] }),
  savedAt: '2026-09-19T13:05:00.000Z',
  reason: 'A save from this device replaced it while syncing.',
});

async function gotoSettings(page: Page) {
  // Settings lives in the avatar menu, not the tab bars.
  await page.locator('#account-menu-btn').click();
  await page.locator('#account-menu-settings-btn').click();
  await expect(page.getByRole('heading', { name: /Account & Cloud Sync/i })).toBeVisible();
}

test.describe('The copy a sync set aside', () => {
  test('is not mentioned when no sync has replaced anything', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await gotoSettings(page);

    await expect(page.locator('#recovery-copy-row')).toHaveCount(0);
  });

  test('is offered for download and discards on request', async ({ page }) => {
    // Seeded once for the session, not on every navigation: the spec reloads to check
    // that discarding sticks, and re-seeding on that reload would erase the point of it.
    await page.addInitScript(
      ([key, value]) => {
        if (sessionStorage.getItem('ptj_e2e_recovery_seeded')) return;
        sessionStorage.setItem('ptj_e2e_recovery_seeded', '1');
        localStorage.clear();
        localStorage.setItem(key, value);
      },
      [RECOVERY_KEY, SET_ASIDE] as const
    );
    await page.goto('/');
    await gotoSettings(page);

    const row = page.locator('#recovery-copy-row');
    await expect(row).toBeVisible();
    // Named plainly, and dated, so it is clear which sync this was.
    await expect(row).toContainText('set aside');

    // The download carries the journal itself, ready to import again.
    const download = page.waitForEvent('download');
    await page.locator('#download-recovery-copy').click();
    const file = await download;
    expect(file.suggestedFilename()).toContain('trading-journal-set-aside-2026-09-19');

    await page.locator('#dismiss-recovery-copy').click();
    await expect(page.locator('#recovery-copy-row')).toHaveCount(0);

    // Discarding is remembered rather than merely hidden for this render.
    await page.reload();
    await gotoSettings(page);
    await expect(page.locator('#recovery-copy-row')).toHaveCount(0);
  });
});
