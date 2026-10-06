import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the copies a sync sets aside, which is what replaced the "use the cloud copy / keep
 * this device's copy" prompt:
 *  - a normal journal shows nothing about sync copies at all
 *  - when a sync displaced work, Settings lists every copy set aside, newest first
 *  - a copy can be downloaded and discarded one at a time, and discarding sticks
 *
 * The suite boots without Supabase, so no sync actually runs here; the spec seeds the copies
 * the way `storage.saveRecoveryCopy` would have left them.
 */

const RECOVERY_KEY = 'ptj_recovery_v1';

/** The journals as they were when a sync moved them out of the way, newest first. */
const SET_ASIDE = JSON.stringify([
  {
    id: 'copy-newer',
    json: JSON.stringify({ tradingDays: [{ id: 'day-2' }], trades: [{ id: 'trade-2' }] }),
    savedAt: '2026-09-20T13:05:00.000Z',
    reason: 'A save from this device replaced it while syncing.',
  },
  {
    id: 'copy-older',
    json: JSON.stringify({ tradingDays: [{ id: 'day-1' }], trades: [{ id: 'trade-1' }] }),
    savedAt: '2026-09-19T13:05:00.000Z',
    reason: 'This device signed in and downloaded the cloud copy over it.',
  },
]);

async function gotoSettings(page: Page) {
  // Settings lives in the avatar menu, not the tab bars.
  await page.locator('#account-menu-btn').click();
  await page.locator('#account-menu-settings-btn').click();
  await expect(page.getByRole('heading', { name: /Account & Cloud Sync/i })).toBeVisible();
}

test.describe('The copies a sync set aside', () => {
  test('are not mentioned when no sync has replaced anything', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await gotoSettings(page);

    await expect(page.locator('#recovery-copy-row')).toHaveCount(0);
  });

  test('are listed newest first and discard one at a time', async ({ page }) => {
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

    // Both copies are offered: the newest keeps the base id, the older the suffixed one.
    await expect(page.locator('#download-recovery-copy')).toBeVisible();
    await expect(page.locator('#download-recovery-copy-1')).toBeVisible();

    // The download carries the journal itself, ready to import again.
    const download = page.waitForEvent('download');
    await page.locator('#download-recovery-copy').click();
    const file = await download;
    expect(file.suggestedFilename()).toContain('trading-journal-set-aside-2026-09-20');

    // Discarding the newest leaves the older one in place — the whole point of holding a
    // history rather than only the latest copy.
    await page.locator('#dismiss-recovery-copy').click();
    await expect(page.locator('#download-recovery-copy-1')).toHaveCount(0);
    const next = page.waitForEvent('download');
    await page.locator('#download-recovery-copy').click();
    expect((await next).suggestedFilename()).toContain('trading-journal-set-aside-2026-09-19');

    await page.locator('#dismiss-recovery-copy').click();
    await expect(page.locator('#recovery-copy-row')).toHaveCount(0);

    // Discarding is remembered rather than merely hidden for this render.
    await page.reload();
    await gotoSettings(page);
    await expect(page.locator('#recovery-copy-row')).toHaveCount(0);
  });
});
