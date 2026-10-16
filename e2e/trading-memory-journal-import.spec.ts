import { test, expect, type Page } from '@playwright/test';

/**
 * The journal import, driven the way the trader drives it.
 *
 * The state this spec exists to fix is the confusing one: a journal holding trade screenshots beside
 * a memory library that searches nothing, with every number on screen correct and no line saying
 * why. So these tests start from exactly that state — one trade with a chart, an empty library — and
 * pin down three things in order: that the screen explains itself, that the picture can be brought
 * across, and that it stays NOT searchable until it has been labelled. That last one is the
 * assertion that matters most: an import that produced a matchable picture would put hindsight into
 * a similarity search, and it would still satisfy a test that only checked the picture arrived.
 *
 * The build is local-only (the config strips the Supabase variables), so the imported picture is
 * kept in the browser rather than uploaded. That is the case worth pinning: the import has to work
 * with no cloud at all, and it has to say where the picture ended up.
 */

/** A real one-pixel PNG, so the reader has something it can actually decode. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Two distinct references, because a picture's identity is derived from where it came from. */
const CHART_ONE = `data:image/png;base64,${PNG_BASE64}`;
const CHART_TWO = `data:image/png;base64,${PNG_BASE64.slice(0, -4)}AAAA`;

const DAYS_KEY = 'ptj_trading_days_v1';
const TRADES_KEY = 'ptj_trades_v1';

/** Both a desktop tab and a mobile tab exist in the DOM; only one is ever visible. */
function memoryTab(page: Page) {
  return page.locator('#nav-btn-memory, #mobile-nav-memory').filter({ visible: true }).first();
}

/**
 * Seeds a journal holding one closed trade with the given screenshots.
 *
 * Written straight into the keys the app reads on mount, which is the only way to get a trade in
 * front of the memory tab without driving the whole trade form first — and the point here is what
 * the memory tab does with a picture that is already there.
 */
async function seedTradeWithCharts(page: Page, images: string[]) {
  await page.goto('/');
  await page.evaluate(
    (seed) => {
      localStorage.removeItem('ptj_observations_v1');
      localStorage.removeItem('ptj_memory_ai_v1');
      const at = '2026-03-03T14:30:00.000Z';
      localStorage.setItem(
        seed.daysKey,
        JSON.stringify([
          {
            id: 'day-1',
            userId: 'u1',
            tradeDate: '2026-03-03',
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
            createdAt: at,
            updatedAt: at,
          },
        ])
      );
      localStorage.setItem(
        seed.tradesKey,
        JSON.stringify([
          {
            id: 'trade-1',
            userId: 'u1',
            tradingDayId: 'day-1',
            instrumentId: 'mes',
            source: 'manual',
            direction: 'long',
            contracts: 1,
            entryPrice: 5000,
            initialStop: 4995,
            exitPrice: 5010,
            entryTime: at,
            exitTime: '2026-03-03T15:05:00.000Z',
            session: 'Regular Session',
            setupName: 'Opening drive',
            initialRisk: 50,
            grossPnL: 50,
            netPnl: 50,
            pointsPnL: 10,
            rMultiple: 1,
            status: 'closed',
            images: seed.images,
            createdAt: at,
            updatedAt: at,
          },
        ])
      );
    },
    { daysKey: DAYS_KEY, tradesKey: TRADES_KEY, images }
  );
  await page.reload();
  await memoryTab(page).click();
  await expect(page.locator('#observation-library')).toBeVisible();
}

test.describe('Trading Memory — bringing the journal’s charts in', () => {
  test('explains the empty library beside a journal full of charts', async ({ page }) => {
    await seedTradeWithCharts(page, [CHART_ONE, CHART_TWO]);

    // The confusing state, stated plainly: the library is empty and the journal is not.
    await expect(page.locator('#observation-empty')).toContainText('Nothing recorded yet');
    await expect(page.locator('#memory-journal-import')).toBeVisible();
    await expect(page.locator('#memory-journal-import-total')).toHaveAttribute('data-value', '2');
    await expect(page.locator('#memory-journal-import-ready')).toHaveAttribute('data-value', '2');
    await expect(page.locator('#memory-journal-import-already')).toHaveAttribute('data-value', '0');
    // And it says what an imported picture will be, before anything is imported.
    await expect(page.locator('#memory-journal-import')).toContainText('unlabelled');
  });

  test('brings a trade screenshot in unlabelled, and no search may use it', async ({ page }) => {
    await seedTradeWithCharts(page, [CHART_ONE]);

    await page.locator('#memory-journal-import-run').click();

    // It is a real record, in the browser, because this build has no bucket to upload to.
    await expect(page.locator('#observation-list article')).toHaveCount(1);
    await expect(page.locator('#observation-unlabelled-obs-journal-trade-1')).toBeVisible();
    await expect(page.locator('#observation-unlabelled-obs-journal-trade-1')).toContainText(
      'unlabelled'
    );
    await expect(page.locator('#observation-list')).toContainText(
      'not searchable until you label it'
    );
    // The picture is readable — it was stored with the record, not merely counted.
    await expect(
      page.locator('#observation-unlabelled-obs-journal-trade-1 img').first()
    ).toBeVisible();

    // The plan now agrees with the library: nothing left to bring in, one waiting for a label.
    await expect(page.locator('#memory-journal-import-ready')).toHaveAttribute('data-value', '0');
    await expect(page.locator('#memory-journal-import-already')).toHaveAttribute('data-value', '1');
    await expect(page.locator('#memory-journal-import-unlabelled')).toHaveAttribute(
      'data-value',
      '1'
    );
    await expect(page.locator('#memory-journal-import-result')).toContainText('Brought in 1 picture');
  });

  test('labelling a picture is what makes it a candidate, and the answer survives a reload', async ({
    page,
  }) => {
    await seedTradeWithCharts(page, [CHART_ONE]);
    await page.locator('#memory-journal-import-run').click();
    await expect(page.locator('#observation-list article')).toHaveCount(1);

    await page.locator('[id^="observation-label-"]').first().click();

    // Labelled: no longer asking, and it is now the record's before-the-decision picture.
    await expect(page.locator('[id^="observation-unlabelled-"]')).toHaveCount(0);
    // Consent is off, so the picture is queued as a refusal rather than as a promise.
    await expect(page.locator('#observation-list')).toContainText('not sent for indexing');
    await expect(page.locator('#observation-list article')).toContainText('Market:');

    await page.reload();
    await memoryTab(page).click();
    await expect(page.locator('#observation-library')).toBeVisible();

    // The record kept its picture AND its label, and the import does not offer it a second time.
    await expect(page.locator('[id^="observation-unlabelled-"]')).toHaveCount(0);
    await expect(page.locator('#observation-list article')).toHaveCount(1);
    await expect(page.locator('#memory-journal-import-already')).toHaveAttribute('data-value', '1');
    await expect(page.locator('#memory-journal-import-ready')).toHaveAttribute('data-value', '0');
  });

  test('the indexing tab says where the journal’s own pictures can be brought in', async ({
    page,
  }) => {
    await seedTradeWithCharts(page, [CHART_ONE]);
    await page.locator('#memory-journal-import-run').click();
    await expect(page.locator('#observation-list article')).toHaveCount(1);

    await page.locator('#memory-section-indexing').click();

    // The number that read as a bug is still correct: the library holds a picture and can search
    // none of it. What is new is that the screen names the way across.
    await expect(page.locator('#memory-indexing')).toContainText('Pictures in this library');
    await expect(page.locator('#memory-indexing-scope')).toContainText('Bring in the charts');

    await page.locator('#memory-section-library').click();
    // And the readiness checklist names the unlabelled picture instead of promising indexing work
    // that no run would ever do.
    await expect(page.locator('#memory-search-readiness')).toContainText(
      'waiting for you to say what it shows'
    );
  });
});
