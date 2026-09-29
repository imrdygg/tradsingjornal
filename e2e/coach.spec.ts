import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the AI coach:
 *  - the tab is reachable and states exactly what it is allowed to know
 *  - it never invents output: with no accessible service it says so instead
 *  - nothing is requested until the trader asks for it
 *  - nothing the coach writes appears anywhere on the Today tab
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

/** The form asks for entry/exit/why/note/tags; the times and the rest are under "More options". */
async function expandTradeOptions(page: Page) {
  const toggle = page.locator('#trade-more-options-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

async function openAddTrade(page: Page) {
  await page.locator('#btn-add-trade-top').click();
  await expect(page.getByRole('heading', { name: /Log a Trade/i })).toBeVisible();
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

  test('names the one outside number it uses before the trader relies on it', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    await expect(page.getByText(/using only what you logged/i)).toBeVisible();
    await expect(page.getByText(/instrument's live price/i)).toBeVisible();
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

  test('has dropped the single-trade critique entirely', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    // The tab reads the trader's setups, entries and exits as a body of work. Picking one
    // trade apart was the one thing it did that was not that, and it is gone — picker,
    // facts and all.
    await expect(page.locator('#coach-trade-select')).toHaveCount(0);
    await expect(page.locator('#coach-trade-facts')).toHaveCount(0);
    await expect(page.locator('#coach-trade-result')).toHaveCount(0);
    await expect(page.getByText(/Critique a trade/i)).toHaveCount(0);
  });

  test('shows the levels it measures price against, without any AI call', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    const card = page.locator('#coach-approach');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Setups about to happen/i);

    // A fresh journal has no levels marked, and the card says so rather than showing a
    // measurement against nothing. This is arithmetic, so it renders with no service.
    await expect(card).toContainText(/No levels are set for today/i);
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
 * The recent-form comparison is computed locally from the trader's own fills, so it has to
 * be honest on screen before any AI call — and, on a journal too thin to compare, it must
 * refuse to name a direction rather than call a trend on a handful of trades.
 */
test.describe('Recent form', () => {
  test('shows the comparison and refuses a direction on a thin journal', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    const card = page.locator('#coach-form-card');
    await expect(card).toBeVisible();
    await expect(page.locator('#coach-form-trend')).toHaveText(/Too few trades/i);
    await expect(card).toContainText(/at least 6 closed trades/i);
  });

  test('asks for nothing until the trader clicks, then reports honestly', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    await expect(page.locator('#coach-form-result')).toHaveCount(0);
    await expect(page.locator('#coach-error-form')).toHaveCount(0);

    await page.locator('#coach-form-generate').click();

    const error = page.locator('#coach-error-form');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Coach not available here/i);
    await expect(page.locator('#coach-form-result')).toHaveCount(0);
  });
});

/**
 * The ask box is the one coach surface the trader types into. Two things matter on screen:
 * nothing is sent until they ask, and an empty question cannot be sent at all — the button
 * is the guard, so the endpoint's own rejection is never what the trader sees.
 */
test.describe('Ask about my trading', () => {
  test('will not ask an empty question, and asks nothing until it is filled in', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    const input = page.locator('#coach-ask-input');
    await expect(input).toBeVisible();
    await expect(page.locator('#coach-ask-generate')).toBeDisabled();

    await input.fill('Why do I keep giving back the morning?');
    await expect(page.locator('#coach-ask-generate')).toBeEnabled();

    // Still nothing requested: the answer only exists once the button is pressed.
    await expect(page.locator('#coach-ask-result')).toHaveCount(0);
    await expect(page.locator('#coach-error-ask')).toHaveCount(0);
  });

  test('reports honestly when the coach service is not reachable', async ({ page }) => {
    await gotoTab(page, 'coach', /Coach/i);

    await page.locator('#coach-ask-input').fill('Why do I keep giving back the morning?');
    await page.locator('#coach-ask-generate').click();

    const error = page.locator('#coach-error-ask');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Coach not available here/i);
    await expect(page.locator('#coach-ask-result')).toHaveCount(0);
  });
});

/**
 * The ask box lives on the Coach tab and nowhere else. It was briefly mirrored on Today so
 * a question could be asked mid-record; that put a second box on the page the trade form is
 * on, so an answer waiting to be read could be scrolled away from the trade being written.
 */
test.describe('The ask box is not duplicated onto Today', () => {
  test('never renders a second instance on the Today tab', async ({ page }) => {
    await expect(page.locator('#today-ask-input')).toHaveCount(0);
    await expect(page.locator('#coach-ask-input')).toHaveCount(0);

    // And the Coach tab still has the box it was written for.
    await gotoTab(page, 'coach', /Coach/i);
    await expect(page.locator('#coach-ask-input')).toBeVisible();
    await expect(page.locator('#today-ask-input')).toHaveCount(0);
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
    // The times are exact here, so they come from under "More options".
    await expandTradeOptions(page);
    await page.locator('#trade-entry-time').fill(trade.entryTime);
    await page.locator('#trade-exit-time').fill(trade.exitTime);
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();
    await expect(page.getByRole('heading', { name: /Log a Trade/i })).toHaveCount(0);
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

});

/**
 * The coach lives on its own tab and nowhere else.
 *
 * Today is for the day's record: the summary, the end-of-day review, the lesson carried
 * forward, the trades and the trend behind them. The coach cards that used to sit on the
 * page put a second, model-written reading of the same journal there, and are gone. Every
 * section on the tab is open, so an absence checked here is an absence from the tab rather
 * than from the visible slice of it.
 */
test.describe('The coach has no home on the Today tab', () => {
  test('renders no coach card anywhere on the tab', async ({ page }) => {
    await expect(page.locator('#coach-checkpoint-card')).toHaveCount(0);
    await expect(page.locator('#coach-comparison-list')).toHaveCount(0);
    await expect(page.locator('#coach-checkpoint-after-loss')).toHaveCount(0);

    // And the fold they used to sit inside is gone with the plan it was named for.
    await expect(page.getByText(/Plan, risk & coach/i)).toHaveCount(0);
    await expect(page.locator('#section-today-advanced-body')).toHaveCount(0);
  });
});
