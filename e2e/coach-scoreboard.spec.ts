import { expect, test, type Page } from '@playwright/test';

/**
 * Where the coach's calls surface: the Analytics scoreboard and the trade log.
 *
 * The calls are stored with the trades by the app itself, so this seeds them straight
 * into the journal and checks both reads of them: the day a call belongs to comes from
 * the parent trading day (not the entry timestamp), the running agreement rate
 * accumulates, a call the coach would have skipped counts as neither agreement nor
 * opposition, and the trade log shows the call beside the fill without inventing one for
 * a trade that has none.
 */

const DAYS_KEY = 'ptj_trading_days_v1';
const TRADES_KEY = 'ptj_trades_v1';

interface SeededTrade {
  id: string;
  dayId: string;
  direction: 'long' | 'short';
  entryPrice: number;
  setup: string;
  session: string;
  /** Stored instrument id. Defaults to the journal's MES. */
  instrument?: string;
  /** Null means no call was recorded, as an imported or pre-coach trade would have. */
  coach: { direction: 'long' | 'short' | 'flat'; entry: number | null } | null;
}

const DAYS = [
  { id: 'day-a', date: '2026-09-17' },
  { id: 'day-b', date: '2026-09-18' },
];

const TRADES: SeededTrade[] = [
  // 17th: one agreement at a better fill, one opposition.
  { id: 't1', dayId: 'day-a', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'long', entry: 7745 } },
  { id: 't2', dayId: 'day-a', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'short', entry: 7745 } },
  // 18th: one agreement at a worse fill, one stand-aside, and one break-out read in the
  // overnight session — so the by-setup and by-session slices each get a thin group.
  { id: 't3', dayId: 'day-b', direction: 'long', entryPrice: 7752, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'long', entry: 7745 } },
  { id: 't4', dayId: 'day-b', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'flat', entry: null } },
  { id: 't5', dayId: 'day-b', direction: 'long', entryPrice: 7740, setup: 'Reversal', session: 'Overnight', coach: { direction: 'long', entry: 7745 } },
];

async function seedJournal(page: Page, trades: SeededTrade[] = TRADES) {
  await page.addInitScript(
    ({ days, trades, daysKey, tradesKey }) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ptj_')) localStorage.removeItem(key);
      }

      localStorage.setItem(
        daysKey,
        JSON.stringify(
          days.map((day) => ({
            id: day.id,
            userId: 'u1',
            tradeDate: day.date,
            status: 'completed',
            riskMode: 'normal',
            normalLossLimit: 100,
            plannedLossLimit: 100,
            contractsPlanned: 1,
            primaryInstrument: 'MES',
            allowedSessions: ['Regular Session'],
            marketBias: 'neutral',
            watchedSetups: [],
            importantLevels: [],
            waitingFor: '',
            stayOutIf: '',
            planChanges: [],
            createdAt: `${day.date}T12:00:00.000Z`,
            updatedAt: `${day.date}T12:00:00.000Z`,
          }))
        )
      );

      localStorage.setItem(
        tradesKey,
        JSON.stringify(
          trades.map((trade) => ({
            id: trade.id,
            userId: 'u1',
            tradingDayId: trade.dayId,
            instrumentId: trade.instrument ?? 'mes',
            source: 'manual',
            direction: trade.direction,
            contracts: 1,
            entryPrice: trade.entryPrice,
            initialStop: trade.entryPrice - 10,
            exitPrice: trade.entryPrice + 5,
            entryTime: '2026-09-17T13:30:00.000Z',
            exitTime: '2026-09-17T14:00:00.000Z',
            session: trade.session,
            setupName: trade.setup,
            initialRisk: 50,
            grossPnL: 25,
            netPnL: 25,
            pointsPnL: 5,
            rMultiple: 0.5,
            status: 'closed',
            createdAt: '2026-09-17T13:30:00.000Z',
            updatedAt: '2026-09-17T14:00:00.000Z',
            coachCall: trade.coach
              ? {
                  direction: trade.coach.direction,
                  entry: trade.coach.entry,
                  stop: trade.coach.entry === null ? null : trade.coach.entry - 10,
                  target: trade.coach.entry === null ? null : trade.coach.entry + 20,
                  rationale: `Coach read for ${trade.id}.`,
                  marketPrice: trade.coach.entry,
                  createdAt: '2026-09-17T13:31:00.000Z',
                }
              : undefined,
          }))
        )
      );
    },
    { days: DAYS, trades, daysKey: DAYS_KEY, tradesKey: TRADES_KEY }
  );

  await page.goto('/');
}

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

test.describe('Coach calls: the Analytics scoreboard and the trade log', () => {
  test('scores the coach’s calls against the trader’s, day by day', async ({ page }) => {
    await seedJournal(page);
    await gotoTab(page, 'analytics', /Performance & Discipline Analytics/i);

    const board = page.locator('#coach-scoreboard');
    await expect(board).toBeVisible();

    // All five entries carry a call.
    await expect(board.getByText(/5 of 5 entries have a coach call/)).toBeVisible();

    // Three agreements, one opposition, one stand-aside: 3 of the 4 directional calls agree.
    await expect(board.getByText('75%').first()).toBeVisible();

    // Each day appears in the table, keyed off the parent trading day rather than the
    // entry timestamp (every seeded entry shares the same timestamp).
    await expect(board.getByText('2026-09-17')).toBeVisible();
    await expect(board.getByText('2026-09-18')).toBeVisible();
    // Day one was one of two, so its own rate is 50%.
    await expect(board.getByText('50%').first()).toBeVisible();

    // By setup: the four Breakout entries give a readable group (2 of 3), while the single
    // Reversal entry is flagged rather than shown as a confident 100%.
    const bySetup = page.locator('#coach-breakdown-setup');
    await expect(bySetup.getByText('Breakout')).toBeVisible();
    await expect(bySetup.getByText('Reversal')).toBeVisible();
    await expect(bySetup.getByText('67%')).toBeVisible();
    await expect(bySetup.getByText('thin')).toHaveCount(1);
    await expect(bySetup.getByTitle(/too few to read as a rate/i)).toHaveCount(1);

    // By session: the same split, because the extra entry was taken overnight.
    const bySession = page.locator('#coach-breakdown-session');
    await expect(bySession.getByText('Regular Session')).toBeVisible();
    await expect(bySession.getByText('Overnight')).toBeVisible();
    await expect(bySession.getByText('thin')).toHaveCount(1);

    // Agreement is never presented as correctness.
    await expect(board.getByText(/Agreement is not correctness/i)).toBeVisible();
  });

  test('shows the coach’s call beside each fill in the trade log', async ({ page }) => {
    // t6 stands in for an imported or pre-coach trade: it has no call to show.
    await seedJournal(page, [
      ...TRADES,
      {
        id: 't6',
        dayId: 'day-a',
        direction: 'short',
        entryPrice: 7760,
        setup: 'Breakout',
        session: 'Regular Session',
        coach: null,
      },
    ]);
    await gotoTab(page, 'trades', /Trade Log/i);

    // Both the table and the mobile cards are in the DOM; the table is the desktop view.
    const table = page.locator('table').first();
    await expect(table.getByTestId('coach-call-t1')).toHaveAttribute('data-coach-verdict', 'agreed');
    await expect(table.getByTestId('coach-call-t1')).toContainText('coach LONG @ 7745.00');
    await expect(table.getByTestId('coach-call-t2')).toHaveAttribute('data-coach-verdict', 'opposed');
    await expect(table.getByTestId('coach-call-t2')).toContainText('coach SHORT @ 7745.00');
    await expect(table.getByTestId('coach-call-t4')).toHaveAttribute('data-coach-verdict', 'coach-flat');
    await expect(table.getByTestId('coach-call-t4')).toContainText('coach flat');

    // A trade with no recorded call shows no chip at all, rather than an empty one.
    await expect(page.getByTestId('coach-call-t6')).toHaveCount(0);

    // Opening the record lays the call out in full, with the reasoning it was made on.
    await table.getByTestId('coach-call-t1').click();
    const detail = page.locator('#trade-detail-modal');
    await expect(detail).toBeVisible();
    await expect(detail.getByText("Coach's call on this entry")).toBeVisible();
    await expect(detail.getByText('Coach agreed')).toBeVisible();
    await expect(detail.getByText(/the coach was LONG at 7745\.00/)).toBeVisible();
    await expect(detail.getByText('Its reasoning')).toBeVisible();
    await expect(detail.getByText('Coach read for t1.')).toBeVisible();
    // The caveat travels with the call, so it is never read as a verdict on the trade.
    await expect(detail.getByText(/not a verdict on the trade/i)).toBeVisible();
  });

  test('explains an entry that has no coach call instead of leaving it a mystery', async ({
    page,
  }) => {
    await seedJournal(page, [
      {
        id: 't6',
        dayId: 'day-a',
        direction: 'short',
        entryPrice: 7760,
        setup: 'Breakout',
        session: 'Regular Session',
        coach: null,
      },
    ]);
    await gotoTab(page, 'trades', /Trade Log/i);

    // Clicking any non-button cell opens the record.
    await page.locator('table').first().locator('tbody tr').first().locator('td').first().click();

    const detail = page.locator('#trade-detail-modal');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(/No call was recorded for this entry/i)).toBeVisible();
  });

  test('splits the coach’s record by the side that was traded', async ({ page }) => {
    await seedJournal(page, [
      // Two longs: the coach took the same side once and the other side once, and the
      // fills straddle its level (+5, then -10).
      { id: 'L1', dayId: 'day-a', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'long', entry: 7745 } },
      { id: 'L2', dayId: 'day-a', direction: 'long', entryPrice: 7755, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'short', entry: 7745 } },
      // Three shorts, all agreed, each filled 5 above the coach's level.
      { id: 'S1', dayId: 'day-a', direction: 'short', entryPrice: 7760, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'short', entry: 7755 } },
      { id: 'S2', dayId: 'day-a', direction: 'short', entryPrice: 7760, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'short', entry: 7755 } },
      { id: 'S3', dayId: 'day-a', direction: 'short', entryPrice: 7760, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'short', entry: 7755 } },
    ]);
    await gotoTab(page, 'analytics', /Performance & Discipline Analytics/i);

    const side = page.locator('#coach-breakdown-side');
    await expect(side.getByRole('columnheader', { name: 'Side' })).toBeVisible();

    // Ordered by directional sample, so the three-call short side leads.
    const rows = side.locator('tbody tr');
    await expect(rows).toHaveCount(2);

    const short = rows.nth(0);
    await expect(short).toContainText('Short');
    await expect(short).toContainText('100%');
    // A short filled ABOVE the coach's level is the better fill, so the edge is positive.
    await expect(short).toContainText('+5');
    await expect(short.getByText('thin')).toHaveCount(0);

    const long = rows.nth(1);
    await expect(long).toContainText('Long');
    await expect(long).toContainText('50%');
    // +5 and -10 average to -2.5: on longs the fills came in worse than the coach's level.
    await expect(long).toContainText('-2.5');

    // Only the two-call long side is too thin to read as a rate.
    await expect(side.getByText('thin')).toHaveCount(1);
    await expect(long.getByText('thin')).toBeVisible();
  });

  test('splits the coach’s record by instrument', async ({ page }) => {
    await seedJournal(page, [
      // MES: two agreements against one opposition, every fill 5 points better than the
      // coach's level.
      { id: 'M1', dayId: 'day-a', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'long', entry: 7745 } },
      { id: 'M2', dayId: 'day-a', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'long', entry: 7745 } },
      { id: 'M3', dayId: 'day-a', direction: 'long', entryPrice: 7740, setup: 'Breakout', session: 'Regular Session', coach: { direction: 'short', entry: 7745 } },
      // MNQ: a single agreement, so its rate is too thin to read.
      { id: 'N1', dayId: 'day-a', direction: 'long', entryPrice: 20000, setup: 'Breakout', session: 'Regular Session', instrument: 'mnq', coach: { direction: 'long', entry: 20005 } },
    ]);
    await gotoTab(page, 'analytics', /Performance & Discipline Analytics/i);

    const byInstrument = page.locator('#coach-breakdown-instrument');
    await expect(byInstrument.getByRole('columnheader', { name: 'Instrument' })).toBeVisible();

    const rows = byInstrument.locator('tbody tr');
    await expect(rows).toHaveCount(2);

    // Ordered by directional sample, so MES leads.
    const mes = rows.nth(0).locator('td').first();
    await expect(mes).toContainText('MES');
    await expect(mes).not.toContainText('mes');
    await expect(rows.nth(0)).toContainText('67%');
    await expect(rows.nth(0)).toContainText('+5');
    await expect(rows.nth(0).getByText('thin')).toHaveCount(0);

    // The label is the instrument's symbol, not the id the trade stores.
    const mnq = rows.nth(1).locator('td').first();
    await expect(mnq).toContainText('MNQ');
    await expect(mnq).not.toContainText('mnq');
    await expect(rows.nth(1)).toContainText('100%');

    // One instrument with a single call is not a finding.
    await expect(byInstrument.getByText('thin')).toHaveCount(1);
    await expect(rows.nth(1).getByText('thin')).toBeVisible();
  });

  test('says plainly when there is nothing to score', async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ptj_')) localStorage.removeItem(key);
      }
    });
    await page.goto('/');
    await gotoTab(page, 'analytics', /Performance & Discipline Analytics/i);

    await expect(page.locator('#coach-scoreboard')).toBeVisible();
    await expect(page.getByText(/Nothing to score yet/i)).toBeVisible();
  });
});
