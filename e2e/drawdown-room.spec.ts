import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the account drawdown room on Today:
 *  - the number moves with the journal rather than sitting on the agreed figure
 *  - profit adds room above it; a loss takes it back
 *
 * The room was read from the equity high-water mark, which meant a winning run left it parked
 * on the agreed limit — the reading the trader reported as broken. A fresh journal starts
 * with the default $1,000 limit and a $100 daily loss plan, so every figure below is the
 * default plus whatever the recorded trade did.
 */

/**
 * Records one closed MES trade of 2 contracts, so a 10-point move is $100 at MES's $5/point.
 * Closed at the moment it is written, because the room only counts realized P&L.
 */
async function recordClosedTrade(page: Page, entry: number, exit: number) {
  await page.locator('#btn-add-trade-top').click();
  await expect(page.getByRole('heading', { name: /Log a Trade/i })).toBeVisible();
  await page.locator('#trade-entry-price').fill(String(entry));
  await page.locator('#trade-initial-stop').fill(String(entry - 20));
  await page.locator('#trade-contracts').fill('2');
  await page.locator('#trade-exit-price').fill(String(exit));
  await page.getByRole('button', { name: /Save Completed Trade/i }).click();
  await expect(page.getByRole('heading', { name: /Today's Trade Executions/i })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

/**
 * A closed trade the way an import leaves one: gross P&L with the fees already taken off it.
 * Written straight into storage, because the record form has no fee field to fill in — which
 * is exactly the case where the net and gross readings differ.
 */
const FEE_BEARING_TRADE = {
  id: 'trade-imported-1',
  userId: 'solo-trader-01',
  tradingDayId: 'day-imported-1',
  instrumentId: 'mes',
  source: 'tradovate_csv',
  direction: 'long',
  contracts: 1,
  entryPrice: 7730,
  initialStop: 7710,
  exitPrice: 7750,
  entryTime: '2026-09-24T14:00:00.000Z',
  exitTime: '2026-09-24T14:20:00.000Z',
  session: 'Regular Session',
  setupName: 'Engulfing',
  initialRisk: 100,
  grossPnL: 200,
  netPnL: 150,
  fees: 50,
  pointsPnL: 20,
  rMultiple: 2,
  status: 'closed',
  riskSource: 'recorded',
  createdAt: '2026-09-24T14:20:00.000Z',
  updatedAt: '2026-09-24T14:20:00.000Z',
};

test.describe('The drawdown room follows the journal', () => {
  test('a winning trade adds room above the agreed drawdown', async ({ page }) => {
    const strip = page.locator('#drawdown-room');
    await expect(strip).toContainText('$1,000.00 room left');
    await expect(strip).toContainText('10 more losing days');

    // +$100 → the room is the agreed limit plus the profit, not the limit again.
    await recordClosedTrade(page, 7730, 7740);

    await expect(strip).toContainText('$1,100.00 room left');
    await expect(strip).toContainText('$100.00 of profit on top of $1,000.00');
    await expect(strip).toContainText('11 more losing days');
  });

  test('the chart behind the number waits for the first closed trade', async ({ page }) => {
    const chart = page.locator('#drawdown-room-chart');
    await expect(chart).toContainText('No closed trade yet');
    await expect(chart.locator('[data-testid="room-chart"]')).toHaveCount(0);

    await recordClosedTrade(page, 7730, 7740);

    // The line appears, and reads the same $1,100.00 the strip does.
    await expect(chart.locator('[data-testid="room-chart"]')).toBeVisible();
    await expect(chart).toContainText('1 closed trade');
    // The card's own money reader drops the cents on whole dollars, like the coach panels.
    await expect(chart).toContainText('Room now$1,100');
    await expect(chart).toContainText('agreed $1,000');
  });

  test('reads the room net of fees, the way the coach reads the account', async ({ page }) => {
    // $200 gross, $150 after fees: the room is the money that reached the account. Written
    // as a load script rather than before the reload, because the journal is cleared of
    // `ptj_` keys on every document — this one runs after that and survives.
    await page.addInitScript(
      (trade) => localStorage.setItem('ptj_trades_v1', JSON.stringify([trade])),
      FEE_BEARING_TRADE
    );
    await page.reload();

    const strip = page.locator('#drawdown-room');
    await expect(strip).toContainText('$1,150.00 room left');
    await expect(strip).not.toContainText('$1,200.00');
    await expect(page.locator('#drawdown-room-chart')).toContainText('Room now$1,150');
  });

  test('a losing trade takes the room back down and reports what it spent', async ({ page }) => {
    // -$100 → the limit is partly spent, so the strip switches to the used-of reading.
    await recordClosedTrade(page, 7730, 7720);

    const strip = page.locator('#drawdown-room');
    await expect(strip).toContainText('$900.00 room left');
    await expect(strip).toContainText('used $100.00 of $1,000.00');
    await expect(strip).toContainText('(90% left)');
    // 10% of the agreed limit spent is the widest room the strip reports.
    await expect(strip).toHaveAttribute('data-stance', 'ample');
  });
});
