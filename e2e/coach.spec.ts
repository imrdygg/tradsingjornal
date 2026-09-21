import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the AI coach:
 *  - the tab is reachable and states exactly what it is allowed to know
 *  - it never invents output: with no accessible service it says so instead
 *  - nothing is requested until the trader asks for it
 *  - the critique picker only offers trades that can actually be reviewed
 *
 * The Playwright server is `vite dev`, which does not serve the `api/` serverless
 * function. That makes these specs the right place to prove the degraded path is
 * honest rather than the optimistic path being pretty.
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

async function openAddTrade(page: Page) {
  await page.locator('#btn-add-trade-top').click();
  await expect(page.getByRole('heading', { name: /Record Futures Trade/i })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Coach tab', () => {
  test('is reachable and states what it is allowed to know', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    // The evidence badge is shown before any AI call, so the advice can be judged.
    await expect(page.locator('#coach-evidence-level')).toBeVisible();
    await expect(page.locator('#coach-evidence-level')).toHaveText(/Thin evidence/i);

    // With an empty journal the coach is told, in the UI, that it has nothing.
    await expect(page.getByText(/No closed trades have been logged yet/i)).toBeVisible();
    await expect(page.getByText(/No end-of-day reviews completed/i)).toBeVisible();
  });

  test('claims no market data, and says so before the trader relies on it', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    await expect(page.getByText(/It cannot see the market/i)).toBeVisible();
    await expect(page.getByText(/no prices, levels, news or predictions/i)).toBeVisible();
  });

  test('asks for nothing until the trader clicks, then reports honestly if it is unavailable', async ({
    page,
  }) => {
    await gotoTab(page, 'coach', /Coach/i);

    // Nothing fires on load: no result and no error panel before the click.
    await expect(page.locator('#coach-brief-result')).toHaveCount(0);
    await expect(page.locator('#coach-error-brief')).toHaveCount(0);

    await page.locator('#coach-brief-generate').click();

    // vite dev has no serverless function, so this must surface as "unavailable"
    // with the real cause — never as invented coaching text.
    const error = page.locator('#coach-error-brief');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Coach not available here/i);
    // The message must name the exact endpoint to check, not just say it failed.
    await expect(error).toContainText(/\/api\/coach/);
    await expect(page.locator('#coach-brief-result')).toHaveCount(0);
  });

  test('will not critique a trade until there is a closed one', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    await expect(page.locator('#coach-trade-select')).toHaveCount(0);
    await expect(page.getByText(/No closed trades yet/i)).toBeVisible();
  });

  test('offers a closed trade for critique, named with its real instrument', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('2');
    await page.locator('#trade-exit-price').fill('7740');
    await page.locator('#trade-entry-reason').fill('Reclaim of the overnight low');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    await gotoTab(page, 'coach', /Coach/i);

    const select = page.locator('#coach-trade-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(1);
    await expect(select.locator('option')).toHaveText(/MES long 2/);
    await expect(select.locator('option')).not.toHaveText(/MES long 2.*undefined/);

    // The facts shown beside the picker are computed locally, so they are real even
    // when the AI service is not running.
    await expect(page.getByText('R multiple')).toBeVisible();
    await expect(page.getByText('Initial risk')).toBeVisible();
  });

  test('shows the deterministic performance numbers without any AI call', async ({ page }) => {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('2');
    await page.locator('#trade-exit-price').fill('7740');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    await gotoTab(page, 'coach', /Coach/i);

    // Scoped to the coach card: the header renders its own P&L badge with the same
    // number, so an unscoped match would pass without the coach working at all.
    const facts = page.locator('#coach-brief-facts');

    // 10 points on 2 MES contracts at $5/pt = $100, and 1R on a $100 stop.
    await expect(facts.getByText('Net P&L')).toBeVisible();
    await expect(facts.getByText('$100', { exact: true })).toBeVisible();
    await expect(facts.getByText('Win rate')).toBeVisible();
    await expect(facts.getByText('100%', { exact: true })).toBeVisible();
  });

  test('the weekly review reports its own failure rather than inventing a review', async ({
    page,
  }) => {
    await gotoTab(page, 'coach', /Coach/i);

    await page.locator('#coach-weekly-generate').click();

    const error = page.locator('#coach-error-weekly');
    await expect(error).toBeVisible();
    await expect(page.locator('#coach-weekly-result')).toHaveCount(0);
  });
});

/**
 * The behavioural facts come from the trader's own timestamps, so they are computed and
 * displayed entirely locally: no AI service, no market data, no network. These specs
 * fix the two things that would make the card dishonest — reporting a pattern from a
 * sample that is too small, and missing an entry that clearly followed a loss.
 */
test.describe('Behaviour read from the trader own timestamps', () => {
  /** Logs a completed trade with explicit entry/exit times so the sequence is readable. */
  async function logTrade(
    page: Page,
    trade: { entry: number; exit: number; entryTime: string; exitTime: string }
  ) {
    await openAddTrade(page);
    await page.locator('#trade-entry-price').fill(String(trade.entry));
    await page.locator('#trade-initial-stop').fill(String(trade.entry - 20));
    await page.locator('#trade-contracts').fill('2');
    await page.locator('#trade-exit-price').fill(String(trade.exit));
    await page.locator('#trade-entry-time').fill(trade.entryTime);
    await page.locator('#trade-exit-time').fill(trade.exitTime);
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();
    await expect(
      page.getByRole('heading', { name: /Record Futures Trade/i })
    ).toHaveCount(0);
  }

  test('shows nothing but an honest empty state on a fresh journal', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    const card = page.locator('#coach-behavior-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Not enough logged trades with times yet/i);
    // Nothing may be reported without a real sample behind it.
    await expect(page.locator('#coach-behavior-after-loss')).toHaveCount(0);
  });

  test('names the entry that followed a loss and groups the trading hour', async ({ page }) => {
    // Three entries in the 09:00 hour, so the hour has a real sample. The middle trade
    // is a loss that closes at 09:45, and the last entry is five minutes after it.
    await logTrade(page, {
      entry: 7730,
      exit: 7740,
      entryTime: '2026-09-18T09:15',
      exitTime: '2026-09-18T09:20',
    });
    await logTrade(page, {
      entry: 7730,
      exit: 7720,
      entryTime: '2026-09-18T09:30',
      exitTime: '2026-09-18T09:45',
    });
    await logTrade(page, {
      entry: 7735,
      exit: 7750,
      entryTime: '2026-09-18T09:50',
      exitTime: '2026-09-18T10:00',
    });

    await gotoTab(page, 'coach', /Coach/i);

    const callout = page.locator('#coach-behavior-after-loss');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText(/1 trade\(s\) were opened within 15 minutes/i);
    await expect(callout).toContainText(/Everything else: 2 trade\(s\)/i);

    // The hour bucket is the trader's own clock time, read at face value.
    const card = page.locator('#coach-behavior-card');
    await expect(card).toContainText('09:00');
    await expect(card).toContainText(/3 trades/);
  });

  test('carries the after-loss fact onto the Today tab', async ({ page }) => {
    await logTrade(page, {
      entry: 7730,
      exit: 7720,
      entryTime: '2026-09-18T09:30',
      exitTime: '2026-09-18T09:45',
    });
    await logTrade(page, {
      entry: 7735,
      exit: 7750,
      entryTime: '2026-09-18T09:50',
      exitTime: '2026-09-18T10:00',
    });

    await gotoTab(page, 'today', /Morning Plan/i);
    await expect(page.locator('#coach-checkpoint-after-loss')).toBeVisible();
  });
});
