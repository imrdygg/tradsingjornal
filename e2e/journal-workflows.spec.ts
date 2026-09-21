import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the reported workflow gaps:
 *  - clicking a trade must open the record you wrote
 *  - a closed trade with no review must be completable, so discipline is real
 *  - a locked plan must be undoable
 *  - the journal must be resettable ("start fresh")
 *  - the Position column must never just be a dash
 */

async function gotoTab(page: Page, tab: string, heading: RegExp) {
  const desktop = page.locator(`#nav-btn-${tab}`);
  const mobile = page.locator(`#mobile-nav-${tab}`);
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

/** Settings lives in the avatar menu, not the tab bars. */
async function openSettings(page: Page, heading: RegExp) {
  await page.locator('#account-menu-btn').click();
  await page.locator('#account-menu-settings-btn').click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function openAddTrade(page: Page) {
  await page.locator('#btn-add-trade-top').click();
  await expect(page.getByRole('heading', { name: /Record Futures Trade/i })).toBeVisible();
}

/** Opens the first trade's detail view via whichever control is on screen. */
async function openFirstTradeDetail(page: Page) {
  const tableView = page.getByRole('button', { name: 'View', exact: true }).first();
  if (await tableView.isVisible()) {
    await tableView.click();
    return;
  }
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Trade details', () => {
  test('clicking a trade card opens everything recorded about it', async ({ page }) => {
    // A closed trade with a written reason and a tag.
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('2');
    await page.locator('#trade-exit-price').fill('7740');
    await page.locator('#trade-entry-reason').fill('Reclaim of the overnight low');
    await page.locator('#trade-tags').fill('clean, morning');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    // Clicking the card body (not a button) opens the record.
    await page.getByText('MES (2x)').first().click();

    // Everything is asserted inside the modal: the collapsed card behind it
    // renders the same values.
    const detail = page.locator('#trade-detail-modal');
    await expect(detail.getByText('Your notes')).toBeVisible();
    await expect(detail.getByText('Reclaim of the overnight low')).toBeVisible();
    await expect(detail.getByText('clean', { exact: true })).toBeVisible();
    await expect(detail.getByText('Execution', { exact: true })).toBeVisible();
    // $100: 10 points * $5/pt * 2 contracts.
    await expect(detail.getByText('$100.00').first()).toBeVisible();
  });

  test('the Position column shows a real position, never just a dash', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    await gotoTab(page, 'trades', /Trade Log/i);

    // The desktop table shows the size and average entry for a single-leg trade.
    if (await page.locator('table').first().isVisible()) {
      await expect(page.getByText('1 MES', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('avg 7730.00').first()).toBeVisible();
    }
  });
});

test.describe('Completing an execution review', () => {
  test('a closed trade can be reviewed so it gets a real discipline score', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.locator('#trade-exit-price').fill('7740');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    // No review yet, so the log flags it for attention.
    await gotoTab(page, 'trades', /Trade Log/i);
    if (await page.locator('table').first().isVisible()) {
      // Scoped to the table: the hidden mobile cards render the same label.
      await expect(page.locator('table').getByText('Review pending').first()).toBeVisible();
    }

    // Open the record and complete the review.
    await openFirstTradeDetail(page);
    await expect(
      page.locator('#trade-detail-modal').getByText(/no discipline score for this trade yet/i)
    ).toBeVisible();
    await page.locator('#start-execution-review').click();
    await page.locator('#save-execution-review').click();

    // The score now shows on the record itself.
    await expect(
      page.locator('#trade-detail-modal').getByText(/% discipline/)
    ).toBeVisible();
  });
});

test.describe('Undoing a plan lock', () => {
  test('a locked plan can be unlocked with a recorded reason', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Morning Plan/i })).toBeVisible();

    await page.locator('#lock-plan-btn').click();

    // The lock opens a preview first: plan stats, the live sector heat map and a coach
    // opinion. In the dev server none of those services exist, so the modal reports
    // both as failed while still leaving the lock reachable — locking must not depend
    // on a network service being up.
    await expect(page.getByText(/Before you lock/i)).toBeVisible();
    await expect(page.getByText(/Sector heat map/i)).toBeVisible();
    await expect(page.getByText(/Coach opinion on this plan/i)).toBeVisible();

    // The preview carries the whole plan rather than a summary, so the trader sees
    // exactly what the lock commits to without going back to the form.
    const preview = page.getByRole('dialog');
    await expect(preview.getByText(/Important price levels/i)).toBeVisible();
    await expect(preview.getByText(/What am I waiting for\?/i)).toBeVisible();
    await expect(preview.getByText('Engulfing, Support, Resistance')).toBeVisible();

    await page.locator('#plan-lock-confirm-btn').click();

    await expect(page.getByText(/Immutable Baseline Stored/i)).toBeVisible();

    await page.locator('#unlock-plan-btn').click();
    await page
      .getByPlaceholder(/Locked too early/i)
      .fill('Locked before I finished marking my levels.');
    await page.getByRole('button', { name: 'Unlock plan' }).click();

    // Back to an editable plan, with the undo kept in the audit trail.
    await expect(page.locator('#lock-plan-btn')).toBeVisible();
    await expect(page.getByText(/Immutable Baseline Stored/i)).toHaveCount(0);
    await expect(page.getByText('Plan Lock')).toBeVisible();
  });
});

test.describe('Multi-instrument labels', () => {
  test('an MNQ trade is labelled MNQ and priced at its own point value', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-instrument-select').selectOption('mnq');
    await page.locator('#trade-entry-price').fill('20000');
    await page.locator('#trade-initial-stop').fill('19990');
    await page.locator('#trade-contracts').fill('2');

    // The live calculation header names the chosen instrument.
    await expect(page.getByText('Live MNQ Calculation')).toBeVisible();

    await page.locator('#trade-exit-price').fill('20020');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    // Labelled with the real instrument, not MES.
    await expect(page.getByText('MNQ (2x)')).toBeVisible();

    // 20 points * $2/pt * 2 contracts = $80. MES's $5/pt would say $200.
    // Scoped to the trade list: the day summary also shows the same P&L.
    await expect(page.locator('#today-trades').getByText('+$80.00').first()).toBeVisible();
    await expect(page.getByText('$200.00')).toHaveCount(0);

    // The trade log names it as well.
    await gotoTab(page, 'trades', /Trade Log/i);
    if (await page.locator('table').first().isVisible()) {
      await expect(
        page.locator('table').getByText('MNQ', { exact: true }).first()
      ).toBeVisible();
    } else {
      await expect(page.getByText('MNQ (2x)')).toBeVisible();
    }
  });

  test('the close dialog names the instrument being closed', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-instrument-select').selectOption('mnq');
    await page.locator('#trade-entry-price').fill('20000');
    await page.locator('#trade-initial-stop').fill('19990');
    await page.locator('#trade-contracts').fill('2');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();

    await page.getByRole('button', { name: /Close Trade/i }).first().click();
    await expect(page.getByText(/2x MNQ @ 20000\.00/)).toBeVisible();
  });
});

test.describe('Starting fresh', () => {
  test('reset clears trades but keeps the playbook', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.getByRole('button', { name: /Save Open Trade/i }).click();
    await expect(page.getByRole('heading', { name: /Trade Executions \(1\)/ })).toBeVisible();

    await openSettings(page, /Settings & Configuration/i);
    await page.locator('#reset-journal-button').click();

    // Two-step guard: the button stays disabled until RESET is typed.
    const confirm = page.locator('#reset-confirm-button');
    await expect(confirm).toBeDisabled();
    await page.locator('#reset-confirm-input').fill('RESET');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText(/Journal reset/i)).toBeVisible();

    // Journal is empty again...
    await gotoTab(page, 'today', /Morning Plan/i);
    await expect(page.getByRole('heading', { name: /Trade Executions \(0\)/ })).toBeVisible();

    // ...but the playbook set-ups survived.
    await gotoTab(page, 'playbook', /Trading Setups & Playbook Library/i);
    await expect(page.getByText('Engulfing', { exact: true })).toBeVisible();
    await expect(page.getByText('Trend Continuation', { exact: true })).toBeVisible();
  });
});
