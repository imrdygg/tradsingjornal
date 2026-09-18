import { expect, test, type Page } from '@playwright/test';

/**
 * An edit may only change what the record form owns.
 *
 * Saving used to rebuild the trade from the form alone, which silently did three
 * things to a trade taken on an earlier day:
 *
 *  1. reassigned it to today's trading day, so it appeared in a session it was never
 *     part of and vanished from its own day in History;
 *  2. relabelled a broker import as hand-recorded; and
 *  3. dropped the assumed-risk flag, which is the app's only warning that an imported
 *     stop price — and the risk, R and expectancy built on it — was invented because a
 *     CSV carries no stop.
 *
 * These specs seed a trade from a previous day and save it without touching anything,
 * which is the smallest edit that used to corrupt all three.
 */

const PROFILE_ID = 'solo-trader-01';

/**
 * Seeds yesterday's session with an imported trade. The seed runs in the page because
 * "yesterday" has to be worked out in the trader's own timezone, the same way the app
 * does it.
 */
async function seedPastTrade(page: Page) {
  await page.addInitScript((userId) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }

    const dateInNewYork = (ms: number) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms));

    const yesterday = dateInNewYork(Date.now() - 24 * 60 * 60 * 1000);
    const dayId = `day-${yesterday}`;
    const entryTime = `${yesterday}T14:00:00.000Z`;
    const exitTime = `${yesterday}T14:06:00.000Z`;

    localStorage.setItem(
      'ptj_trading_days_v1',
      JSON.stringify([
        {
          id: dayId,
          userId,
          tradeDate: yesterday,
          status: 'completed',
          riskMode: 'normal',
          normalLossLimit: 100,
          plannedLossLimit: 100,
          contractsPlanned: 2,
          primaryInstrument: 'MES',
          allowedSessions: ['Regular Session'],
          marketBias: 'neutral',
          watchedSetups: ['Engulfing'],
          importantLevels: [],
          waitingFor: '',
          stayOutIf: '',
          notes: '',
          planChanges: [],
          createdAt: entryTime,
          updatedAt: entryTime,
        },
      ])
    );

    // Shaped exactly like a broker import: `riskSource` is deliberately absent, because
    // the importer does not write it either, and the stop came from the importer's
    // placeholder rather than from the trader.
    localStorage.setItem(
      'ptj_trades_v1',
      JSON.stringify([
        {
          id: 'tradovate-past-1',
          userId,
          tradingDayId: dayId,
          instrumentId: 'mes',
          source: 'tradovate_csv',
          direction: 'long',
          contracts: 2,
          entryPrice: 7700,
          initialStop: 7690,
          exitPrice: 7705,
          entryTime,
          exitTime,
          session: 'Regular Session',
          notes: 'Imported from broker CSV',
          initialRisk: 100,
          grossPnL: 50,
          pointsPnL: 5,
          rMultiple: 0.5,
          status: 'closed',
          createdAt: entryTime,
          updatedAt: entryTime,
        },
      ])
    );
  }, PROFILE_ID);
}

const ASSUMED_RISK_SUMMARY = '#assumed-risk-summary';

async function gotoTab(page: Page, tab: string, heading: RegExp) {
  const desktop = page.locator(`#nav-btn-${tab}`);
  const mobile = page.locator(`#mobile-nav-${tab}`);
  if (await desktop.isVisible()) await desktop.click();
  else await mobile.click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

/**
 * Opens the editor for the seeded trade and saves it without changing a field.
 *
 * The trades view renders a card list and a table at once with one hidden, so the edit
 * affordance has to be picked from whichever layout is actually on screen: the card
 * carries only an icon, the table row has a text button.
 */
async function openEditorAndSave(page: Page) {
  await gotoTab(page, 'trades', /Trade Log/i);

  const cardEdit = page.locator('[title="Edit Trade"]:visible');
  const tableEdit = page.locator('button:visible', { hasText: /^Edit$/ });
  const button = (await cardEdit.count()) > 0 ? cardEdit.first() : tableEdit.first();

  await button.click();

  const save = page.getByRole('button', { name: /Update Trade/i });
  await expect(save).toBeVisible();
  await save.click();
}

test.describe('Editing a trade keeps its day and its provenance', () => {
  test.beforeEach(async ({ page }) => {
    await seedPastTrade(page);
    await page.goto('/');
  });

  test('saving a past trade does not move it into today', async ({ page }) => {
    // Yesterday's trade is not part of today's session to start with.
    await expect(page.getByText(/Today's Trade Executions \(0\)/)).toBeVisible();

    await openEditorAndSave(page);

    // Nor after being opened and saved: a trade belongs to the day it was taken,
    // otherwise both days' figures are wrong.
    await gotoTab(page, 'today', /Morning Plan/i);
    await expect(page.getByText(/Today's Trade Executions \(0\)/)).toBeVisible();
    await expect(page.getByText(/No trades logged for today yet/i)).toBeVisible();
  });

  test('saving an import does not launder the stop the CSV never had', async ({ page }) => {
    await gotoTab(page, 'settings', /Settings & Configuration/i);
    await expect(page.locator(ASSUMED_RISK_SUMMARY)).toHaveText(
      /1 trade still use an assumed stop/i
    );

    await openEditorAndSave(page);

    // The stop is still the importer's placeholder, so the app must keep saying so
    // rather than presenting risk and R built on an invented price as real numbers.
    await gotoTab(page, 'settings', /Settings & Configuration/i);
    await expect(page.locator(ASSUMED_RISK_SUMMARY)).toHaveText(
      /1 trade still use an assumed stop/i
    );
  });
});
