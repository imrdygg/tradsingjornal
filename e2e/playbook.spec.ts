import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_SETUPS } from '../src/lib/storage';

/**
 * Smoke tests for the Playbook tab.
 *
 * The app boots local-only (no Supabase in the test env), so a fresh journal gets the whole
 * built-in catalog — which is now exactly the trader's two level setups, Support and
 * Resistance — and a trading day that watches those same two.
 *
 * Because the catalog and the focus pair are the same two setups, there is usually nothing
 * hidden and no focus control on screen. It appears the moment anything sits outside the
 * pair: a setup the trader adds, or a draft the coach wrote. `revealAllSetups` handles both
 * cases, which is why it no longer insists the control exists.
 */

/** One example chart, which draws its dashed level as a 4-3 line. */
const DIAGRAM_WITH_LEVEL = 'svg[role="img"] line[stroke-dasharray="4 3"]';

const SUPPORT_SUMMARY =
  'Buying a proven demand zone where price has repeatedly stopped falling and bounced';

/** Open the Playbook tab via whichever nav is visible at the current viewport. */
async function gotoPlaybook(page: Page) {
  const desktop = page.locator('#nav-btn-playbook');
  const mobile = page.locator('#mobile-nav-playbook');
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await expect(page.getByRole('heading', { name: /Trading Setups & Playbook Library/i })).toBeVisible();
}

/**
 * Reveals anything sitting outside the focus pair.
 *
 * On a fresh journal the catalog *is* the pair, so the control is not rendered at all and
 * there is nothing to do. It only shows up once a setup has been added or learned, which is
 * exactly when a test needs it. Safe to call twice, or on a page already showing everything.
 */
async function revealAllSetups(page: Page) {
  const toggle = page.locator('#playbook-focus-toggle');
  if ((await toggle.count()) === 0) return;
  if ((await toggle.textContent())?.includes('Show all setups')) await toggle.click();
}

/** The card for one setup, found by the title on its name rather than by its text. */
function setupCard(page: Page, name: string) {
  return page.locator('div.rounded-2xl', { has: page.getByTitle(name, { exact: true }) }).first();
}

test.beforeEach(async ({ page }) => {
  // Deterministic local state: a fresh journal for every test run.
  //
  // The clear is guarded by sessionStorage because an init script runs on EVERY
  // navigation, not just the first one — so an unguarded clear would wipe the journal on
  // reload, and no test could ever assert that anything was actually persisted. A new
  // test gets a new page and therefore an empty sessionStorage, so each one still starts
  // clean.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ptj_e2e_cleared')) return;
    sessionStorage.setItem('ptj_e2e_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Playbook tab', () => {
  test('opens on the two level setups the app is built around', async ({ page }) => {
    await gotoPlaybook(page);

    for (const name of ['Support', 'Resistance']) {
      await expect(page.getByTitle(name, { exact: true })).toBeVisible();
    }

    // The catalog is exactly those two, so nothing is hidden and the focus bar is absent.
    // Addressed by title because the diagrams label their level with the same word, so a
    // text match would resolve to two elements.
    await expect(page.locator('#playbook-focus-bar')).toHaveCount(0);
    await expect(page.getByTitle('Engulfing', { exact: true })).toHaveCount(0);
  });

  test('a setup added on top of the pair sits behind the focus control', async ({ page }) => {
    await gotoPlaybook(page);
    await expect(page.locator('#playbook-focus-bar')).toHaveCount(0);

    await page.getByPlaceholder(/Fair Value Gap/).fill('My Own Setup');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // Adding reveals it immediately — the trader must not lose what they just typed.
    await expect(page.getByTitle('My Own Setup', { exact: true })).toBeVisible();
    await expect(page.locator('#playbook-focus-bar')).toContainText('Showing all 3 setups');

    // Pressing the control trims back to the two the app is built around.
    await page.locator('#playbook-focus-toggle').click();
    await expect(page.locator('#playbook-focus-bar')).toContainText('Showing your 2 setup(s)');
    await expect(page.getByTitle('My Own Setup', { exact: true })).toHaveCount(0);
    await expect(page.getByTitle('Support', { exact: true })).toBeVisible();
  });

  test('the whole card toggles the study guide, not just its icon', async ({ page }) => {
    await gotoPlaybook(page);

    const card = setupCard(page, 'Resistance');
    const guide = card.getByText('How this setup forms');

    // Folded to start with, and hidden rather than merely clipped.
    await expect(card.getByTitle('Show study guide')).toHaveAttribute('aria-expanded', 'false');
    await expect(guide).toBeHidden();

    // Clicking the setup name — not a button, not an icon — unfolds the guide.
    await card.getByTitle('Resistance', { exact: true }).click();
    await expect(card.getByTitle('Hide study guide')).toHaveAttribute('aria-expanded', 'true');
    await expect(guide).toBeVisible();
    await expect(card.locator('svg[role="img"]')).toHaveCount(2);

    // Pressing the header again folds it back away.
    await card.getByTitle('Hide study guide').click();
    await expect(guide).toBeHidden();
  });

  test('expands a study guide with diagrams, formation and trading rules', async ({ page }) => {
    await gotoPlaybook(page);

    // Every setup card shows its always-visible summary line.
    await expect(page.getByText(SUPPORT_SUMMARY, { exact: false })).toBeVisible();

    const card = setupCard(page, 'Support');
    await card.getByTitle('Show study guide').click();

    await expect(card.getByText('How this setup forms')).toBeVisible();
    await expect(card.getByText('How to trade it')).toBeVisible();
    await expect(card.getByText(/Invalidation/)).toBeVisible();

    // Green/red example diagrams render (bullish + bearish SVG charts).
    const diagrams = card.locator('svg[role="img"]');
    await expect(diagrams).toHaveCount(2);
    await expect(card.getByText(/Green — bullish example/i)).toBeVisible();
    await expect(card.getByText(/Red — bearish example/i)).toBeVisible();

    // Collapse again.
    await card.getByTitle('Hide study guide').click();
    await expect(card.getByText('How this setup forms')).toBeHidden();
  });

  test('every built-in setup draws both examples with its dashed level', async ({ page }) => {
    await gotoPlaybook(page);
    await revealAllSetups(page);

    // Driven from the catalog rather than from a list written out here, so a setup added
    // later without a level line fails this test instead of shipping a chart that shows
    // candles moving without the price the setup is waiting on.
    for (const setup of DEFAULT_SETUPS) {
      const card = setupCard(page, setup.name);

      // One bullish and one bearish example, each with its level.
      await expect(card.locator('svg[role="img"]')).toHaveCount(2);
      await expect(card.locator(DIAGRAM_WITH_LEVEL)).toHaveCount(2);
    }
  });

  test('the built-in setups name the level they wait on, not just draw it', async ({ page }) => {
    await gotoPlaybook(page);

    const card = setupCard(page, 'Resistance');
    await card.getByTitle('Show study guide').click();

    // The level is not just a dashed line, it is labelled — that is what makes the example
    // teach where the setup is entered rather than only which way it goes.
    await expect(card.locator('svg[role="img"] text')).toHaveCount(2);
    await expect(card.locator('svg[role="img"] text').first()).toHaveText('Resistance');
    await expect(card.locator('svg[role="img"] text').last()).toHaveText('Resistance');
  });

  test('a custom setup gets the generic examples rather than an empty space', async ({ page }) => {
    await gotoPlaybook(page);

    await page.getByPlaceholder(/Fair Value Gap/).fill('My Own Setup');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const card = setupCard(page, 'My Own Setup');

    // A setup the catalog has never heard of still shows a chart with a level, and says
    // plainly that the chart is generic so it is not read as a picture of their setup.
    await expect(card.locator(DIAGRAM_WITH_LEVEL)).toHaveCount(2);
    await card.getByTitle('Show study guide').click();
    await expect(card.getByText(/generic rising and\s+falling examples/i)).toBeVisible();
  });

  test('default watched setups are highlighted with a clickable badge', async ({ page }) => {
    await gotoPlaybook(page);

    // The seeded day watches the two level setups, which are the two shown.
    for (const name of ['Support', 'Resistance']) {
      await expect(setupCard(page, name).getByText('Watched today')).toBeVisible();
    }
    // Unwatched setups must not show the badge.
    await expect(page.getByText('Watched today')).toHaveCount(2);

    // The badge is a button that opens the study guide.
    const card = setupCard(page, 'Support');
    await card.getByText('Watched today').click();
    await expect(card.getByText('How this setup forms')).toBeVisible();
  });

  test('a setup the coach wrote is badged as an AI draft, and yours are not', async ({ page }) => {
    // Seeded after the fresh-journal clear: the catalog the coach writes into already holds
    // the trader's own two, exactly as it would on a real journal.
    await page.addInitScript(() => {
      localStorage.setItem(
        'ptj_setups_v1',
        JSON.stringify([
          { id: 'support', name: 'Support', active: true, createdAt: '2026-01-01T00:00:00Z' },
          { id: 'resistance', name: 'Resistance', active: true, createdAt: '2026-01-01T00:00:00Z' },
          {
            id: 'setup-ai-1',
            name: 'Failed open-range break',
            active: true,
            origin: 'ai',
            description: 'Draft written by the coach from your last twelve trades.',
            createdAt: '2026-09-29T00:00:00Z',
          },
        ])
      );
    });
    await page.goto('/');
    await gotoPlaybook(page);

    // The trader's own two lead the library and carry no badge.
    await expect(page.getByTitle('Support', { exact: true })).toBeVisible();
    await expect(page.getByTitle('Resistance', { exact: true })).toBeVisible();
    await expect(page.locator('[id^="setup-ai-badge-"]')).toHaveCount(0);

    // The coach's draft is one click away, and says where it came from.
    await revealAllSetups(page);
    const aiCard = setupCard(page, 'Failed open-range break');
    await expect(aiCard.locator('#setup-ai-badge-setup-ai-1')).toBeVisible();
    await expect(aiCard.getByText('AI draft')).toBeVisible();
  });
});

/**
 * Closing out a marked level that price never reached.
 *
 * A line the trader writes down and nothing was logged against used to be indistinguishable
 * from one they simply never got to. These tests drive the two new marks through the real
 * card: a line can be closed out as never touched, or set aside as void, and both survive a
 * reload because they are written to the journal rather than held in React state.
 */
test.describe('Marked levels — never touched and void', () => {
  /** Writes one resistance line for the instrument on screen and saves it. */
  async function markResistance(page: Page, price: string) {
    await page.locator('#level-prices-resistance').fill(price);
    await page.locator('#level-add-both').click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(1);
  }

  test('closes an untouched line out as never touched, and it survives a reload', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-never-touched-btn-"]').click();

    await expect(row).toHaveAttribute('data-level-resolution', 'never-touched');

    // The real assertion: it is in the journal, not just on screen.
    await page.reload();
    await gotoPlaybook(page);
    await expect(page.locator('[data-marked-level]').first()).toHaveAttribute(
      'data-level-resolution',
      'never-touched'
    );
  });

  test('edits a marked line in place and the correction survives a reload', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    const row = page.locator('[data-marked-level]').first();
    // The pencil is the only edit control before the form is open.
    await row.locator('button[id^="level-edit-"]').first().click();
    await row.locator('input[id^="level-edit-price-"]').fill('7765.25');
    await row.locator('button[id^="level-edit-save-"]').click();

    await expect(row.getByText('7765.25', { exact: true })).toBeVisible();

    await page.reload();
    await gotoPlaybook(page);
    // Scoped to the marked-levels card: the same price also renders in the edge finder's list.
    await expect(
      page.locator('[data-marked-level]').first().getByText('7765.25', { exact: true })
    ).toBeVisible();
  });

  test('re-dates a line to the session it belongs to, and it survives a reload', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7791');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-edit-"]').first().click();
    // A line written down under the wrong day is moved to the one it was really read on.
    await row.locator('input[id^="level-edit-date-"]').fill('2026-09-24');
    await row.locator('button[id^="level-edit-save-"]').click();

    // It is no longer today's line, but the card offers the earlier session it moved to.
    await expect(page.locator('[data-marked-level]')).toHaveCount(0);
    await expect(page.locator('#level-show-earlier')).toBeVisible();

    await page.reload();
    await gotoPlaybook(page);
    await page.locator('#level-show-earlier').click();
    const moved = page.locator('[data-marked-level]').first();
    await expect(moved.getByText('7791.00', { exact: true })).toBeVisible();
    await expect(moved).toContainText('Sep 24');
  });

  test('moves a line to another chart and carries its touch with it', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    // A touch is logged while the line lives on the 5m chart.
    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-touch-first-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(1);

    // Re-tag the line onto the 15m chart.
    await row.locator('button[id^="level-edit-"]').first().click();
    await row.locator('select[id^="level-edit-timeframe-"]').selectOption('15m');
    await row.locator('button[id^="level-edit-save-"]').click();

    // It is gone from the 5m chart it no longer belongs to...
    await expect(page.locator('[data-marked-level]')).toHaveCount(0);

    // ...and present on the 15m chart, with the touch that moved with it.
    await page.locator('#level-tf-15m').click();
    const moved = page.locator('[data-marked-level]').first();
    await expect(moved.getByText('7760.00', { exact: true })).toBeVisible();
    await expect(moved.locator('[data-level-touch]')).toHaveCount(1);

    await page.reload();
    await gotoPlaybook(page);
    await page.locator('#level-tf-15m').click();
    await expect(page.locator('[data-marked-level]').first().locator('[data-level-touch]')).toHaveCount(1);
  });

  test('removes a touch tapped by mistake, leaving the line in place', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-touch-first-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(1);

    // The undo: the touch is taken off, the line stays marked.
    await row.locator('button[id^="level-touch-remove-"]').click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(0);
    await expect(row.locator('button[id^="level-touch-first-"]')).toBeVisible();

    await page.reload();
    await gotoPlaybook(page);
    const reloaded = page.locator('[data-marked-level]').first();
    await expect(reloaded.locator('[data-level-touch]')).toHaveCount(0);
  });

  test('reaches back to earlier days and edits a line that is not today\u2019s', async ({ page }) => {
    // A line written down a week earlier, and a trading day to hold it. Seeded after the
    // fresh-journal clear so it is the only level on the record.
    await page.addInitScript(() => {
      localStorage.setItem(
        'ptj_marked_levels_v1',
        JSON.stringify([
          {
            id: 'level-old-mcl',
            userId: 'solo-trader-01',
            tradingDayId: 'day-2026-09-25',
            tradeDate: '2026-09-25',
            instrumentId: 'mes',
            kind: 'resistance',
            price: 7788,
            zonePoints: 2,
            session: 'Regular Session',
            timeframe: '5m',
            createdAt: '2026-09-25T13:00:00.000Z',
            updatedAt: '2026-09-25T13:00:00.000Z',
          },
        ])
      );
    });
    await page.goto('/');
    await gotoPlaybook(page);

    // Today's list is empty, but the earlier line is one click away.
    await expect(page.locator('#level-show-earlier')).toBeVisible();
    await page.locator('#level-show-earlier').click();

    const row = page.locator('[data-marked-level]').first();
    await expect(row.getByText('7788.00', { exact: true })).toBeVisible();
    await expect(row).toHaveAttribute('data-level-resolution', 'open');
    // It is reachable rather than only counted: the pencil is there to correct it.
    await expect(row.locator('button[id^="level-edit-"]').first()).toBeVisible();
  });

  test('sets a line aside as void, keeping it on the record and out of the counts', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7765');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-void-btn-"]').click();

    await expect(row).toHaveAttribute('data-level-resolution', 'void');
    // The badge, not the button: both read "Void", so address the badge by its id.
    await expect(row.locator('span[id^="level-void-"]')).toBeVisible();

    await page.reload();
    await gotoPlaybook(page);
    const reloaded = page.locator('[data-marked-level]').first();
    await expect(reloaded).toHaveAttribute('data-level-resolution', 'void');

    // The line is kept, not deleted: it can be reopened from here.
    await reloaded.locator('button[id^="level-void-btn-"]').click();
    await expect(reloaded).toHaveAttribute('data-level-resolution', 'open');
  });

  test('decides a logged touch from the line it belongs to, and it survives a reload', async ({
    page,
  }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7758');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-touch-first-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(1);

    // Logging a touch opens its outcome controls, so deciding it is the next thing, not a hunt.
    const touchId = await row.locator('[data-level-touch]').first().getAttribute('data-level-touch');
    const controls = page.locator(`[data-touch-outcome-controls="${touchId}"]`);
    await expect(controls).toBeVisible();

    // A fresh touch is watching until it is decided.
    await expect(row.locator('[data-level-touch]').first()).toContainText('watching');

    await page.locator(`#touch-outcome-never-returned-${touchId}`).click();
    await expect(page.locator(`#touch-outcome-never-returned-${touchId}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // The badge reads the held outcome, which is what every rate is built from.
    await expect(row.locator('[data-level-touch]').first()).toContainText('held');

    await page.reload();
    await gotoPlaybook(page);
    const reloaded = page.locator('[data-marked-level]').first();
    await expect(reloaded.locator('[data-level-touch]').first()).toContainText('held');

    // And the decision is editable from the same place, back to watching if it was too soon.
    const reloadedTouchId = await reloaded
      .locator('[data-level-touch]')
      .first()
      .getAttribute('data-level-touch');
    await reloaded.locator('button[id^="level-touch-decide-"]').first().click();
    await page.locator(`#touch-outcome-watching-${reloadedTouchId}`).click();
    await expect(reloaded.locator('[data-level-touch]').first()).toContainText('watching');
  });

  test('records which way price left a decided touch, and keeps it across a reload', async ({
    page,
  }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7770');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-touch-first-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();

    const touchId = await row.locator('[data-level-touch]').first().getAttribute('data-level-touch');
    await page.locator(`#touch-outcome-never-returned-${touchId}`).click();

    // A break that never came back asks WHEN it broke away, and which way — not a distance.
    await expect(page.locator(`[data-touch-outcome-controls="${touchId}"]`)).toContainText(
      'Broke away at'
    );

    // Direction is the trader's own call: both ways are offered and neither is preselected.
    const up = page.locator(`#touch-direction-up-${touchId}`);
    const down = page.locator(`#touch-direction-down-${touchId}`);
    await expect(up).toHaveAttribute('aria-pressed', 'false');
    await expect(down).toHaveAttribute('aria-pressed', 'false');

    await down.click();
    await expect(down).toHaveAttribute('aria-pressed', 'true');
    // The badge carries the recorded direction so a row of repeats reads at a glance.
    await expect(row.locator('span[id^="level-touch-direction-"]')).toHaveText('↓');

    await page.reload();
    await gotoPlaybook(page);
    await expect(
      page.locator('[data-marked-level]').first().locator('span[id^="level-touch-direction-"]')
    ).toHaveText('↓');
  });

  test('sorts the marked lines by price or by newest, at the trader\u2019s choice', async ({ page }) => {
    await gotoPlaybook(page);
    // Two resistance lines pasted low-then-high, so paste order differs from price order.
    await page.locator('#level-prices-resistance').fill('7745\n7790');
    await page.locator('#level-add-both').click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(2);

    const order = () =>
      page
        .locator('[data-level-price]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-level-price')));

    // Price order is the default: resistance reads high to low.
    await expect.poll(order).toEqual(['7790', '7745']);

    await page.locator('#level-sort-newest').click();
    await expect.poll(order).toEqual(['7745', '7790']);

    await page.locator('#level-sort-price').click();
    await expect.poll(order).toEqual(['7790', '7745']);
  });

  test('a freshly marked line reads as not touched until you say so, then takes repeats', async ({
    page,
  }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    const row = page.locator('[data-marked-level]').first();

    // Adding a price does not touch it: the line says so itself, so the action below it cannot
    // be read as a status saying the level was already reached.
    await expect(row).toHaveAttribute('data-level-touch-state', 'untouched');
    await expect(row.locator('span[id^="level-untouched-"]')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Mark touched' })).toBeVisible();

    // Marking it touched is the trader's own choice, and it asks for the time it happened.
    await row.locator('button[id^="level-touch-first-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();

    await expect(row).toHaveAttribute('data-level-touch-state', 'touched');
    await expect(row.locator('[data-level-touch]')).toHaveCount(1);
    await expect(row.locator('span[id^="level-untouched-"]')).toHaveCount(0);

    // The same line can be reached again and again — each one is added, not replaced.
    await row.locator('button[id^="level-touch-again-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(2);
    await expect(row.getByText('×2 touches')).toBeVisible();
  });
});

/**
 * How a marked line's price reads on screen.
 *
 * The price is stored as a number, so a crude line entered at 80.80 or 89.30 comes back as
 * 80.8 and 89.3. Printing the number straight drops the trailing zero and reads as a
 * different price; the list must show the two decimals the field is typed in, while the
 * stored value — the number the sort tests read — is left alone.
 */
test.describe('Marked level prices', () => {
  test('shows the trailing zero a stored number drops, without changing the stored value', async ({
    page,
  }) => {
    await gotoPlaybook(page);
    await page.locator('#level-prices-resistance').fill('7760.80');
    await page.locator('#level-add-both').click();

    const row = page.locator('[data-marked-level]').first();
    await expect(row.getByText('7760.80', { exact: true })).toBeVisible();
    // The bare number is gone from the screen, but it is still what is stored.
    await expect(row.getByText('7760.8', { exact: true })).toHaveCount(0);
    await expect(row.locator('[data-level-price]')).toHaveAttribute('data-level-price', '7760.8');
  });
});

/**
 * Taking back the last marked-level action.
 *
 * Deleting a line is one tap and easy to mean nothing by, and re-keying it — with the touches it
 * carries — is exactly what the trader should not have to do to recover. These drive the button
 * through the real card, and check the record itself across a reload, so an undo that only
 * repainted the screen would fail.
 */
test.describe('Undoing the last level action', () => {
  async function markResistance(page: Page, price: string) {
    await page.locator('#level-prices-resistance').fill(price);
    await page.locator('#level-add-both').click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(1);
  }

  test('nothing to take back until something has changed', async ({ page }) => {
    await gotoPlaybook(page);
    await expect(page.locator('#level-undo')).toHaveCount(0);
  });

  test('puts a line deleted by mistake back, with its price, and it survives a reload', async ({
    page,
  }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    // Now there is something to take back, and it names what.
    await expect(page.locator('#level-undo')).toBeVisible();
    await expect(page.locator('#level-undo')).toHaveAttribute('title', 'Undo the line you just logged');

    // One tap on the trash removes it — the accident this is here for.
    await page
      .locator('[data-marked-level]')
      .first()
      .locator('button[title="Remove this level from the record"]')
      .click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(0);
    await expect(page.locator('#level-undo')).toHaveAttribute('title', 'Undo the line you removed');

    // The undo brings the line back exactly as it was, and then has nothing left to take back.
    await page.locator('#level-undo').click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(1);
    await expect(
      page.locator('[data-marked-level]').first().getByText('7760.00', { exact: true })
    ).toBeVisible();
    await expect(page.locator('#level-undo')).toHaveCount(0);

    // Written to the record, not just to the screen.
    await page.reload();
    await gotoPlaybook(page);
    await expect(page.locator('[data-marked-level]')).toHaveCount(1);
  });

  test('takes a line that was just marked back off the chart', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    await page.locator('#level-undo').click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(0);
    await expect(page.locator('#level-undo')).toHaveCount(0);

    await page.reload();
    await gotoPlaybook(page);
    await expect(page.locator('[data-marked-level]')).toHaveCount(0);
  });

  test('brings back a touch removed by mistake, leaving the line in place', async ({ page }) => {
    await gotoPlaybook(page);
    await markResistance(page, '7760');

    const row = page.locator('[data-marked-level]').first();
    await row.locator('button[id^="level-touch-first-"]').click();
    await row.getByRole('button', { name: 'Log touch' }).click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(1);

    await row.locator('button[id^="level-touch-remove-"]').click();
    await expect(row.locator('[data-level-touch]')).toHaveCount(0);
    await expect(page.locator('#level-undo')).toHaveAttribute('title', 'Undo the touch you removed');

    await page.locator('#level-undo').click();
    await expect(page.locator('[data-marked-level]').first().locator('[data-level-touch]')).toHaveCount(1);

    // The touch comes back on the record too.
    await page.reload();
    await gotoPlaybook(page);
    await expect(page.locator('[data-marked-level]').first().locator('[data-level-touch]')).toHaveCount(1);
  });
});

/**
 * Carrying a price from one chart to another.
 *
 * The indicator draws the same line on more than one timeframe, so a price already marked on the
 * 15m is offered while the 5m is open. Dragging it into a box, or tapping it, must add the level
 * to the chart on screen — re-keying every shared line is the tedium this removes.
 */
test.describe('Carrying a level between timeframes', () => {
  /** Marks one resistance line on the 15m chart and returns to the 5m. */
  async function markFifteenThenOpenFive(page: Page) {
    await page.locator('#level-tf-15m').click();
    await page.locator('#level-prices-resistance').fill('7760');
    await page.locator('#level-add-both').click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(1);
    await page.locator('#level-tf-5m').click();
  }

  /**
   * Drags a carried chip onto a drop box with the given kind of pointer.
   *
   * The component reads presses with Pointer Events, so a finger and a mouse take the very same
   * path: `pointerdown` on the chip, then `pointermove` and `pointerup` anywhere in the window.
   * The events are dispatched by hand with explicit coordinates because that is the one thing a
   * synthetic gesture can control here, and because the drop is hit-tested against the release
   * point — so those coordinates have to land inside the box for the drop to count.
   */
  async function dragCarryChip(
    page: Page,
    chipSelector: string,
    dropSelector: string,
    pointerType: 'mouse' | 'touch'
  ) {
    // The release is hit-tested with elementFromPoint, which only sees what is on screen, so the
    // box has to be in the viewport before its coordinates are measured — especially on a phone.
    await page.locator(dropSelector).scrollIntoViewIfNeeded();
    const chipBox = await page.locator(chipSelector).boundingBox();
    const dropBox = await page.locator(dropSelector).boundingBox();
    if (!chipBox || !dropBox) throw new Error('carry chip or drop box is not measurable');
    const start = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };
    const end = { x: dropBox.x + dropBox.width / 2, y: dropBox.y + dropBox.height / 2 };

    await page.evaluate(
      ({ chipSelector, x, y, pointerType }) => {
        const chip = document.querySelector(chipSelector);
        if (!chip) throw new Error(`carry chip ${chipSelector} not found`);
        chip.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerType,
            pointerId: 1,
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: x,
            clientY: y,
          })
        );
      },
      { chipSelector, x: start.x, y: start.y, pointerType }
    );

    // One move past the drag threshold, then the release over the box, on the window: the same
    // listener the component attaches at press time. The release point is what decides the side.
    await page.evaluate(
      ({ x, y, pointerType }) => {
        const opts = {
          bubbles: true,
          cancelable: true,
          pointerType,
          pointerId: 1,
          isPrimary: true,
          clientX: x,
          clientY: y,
        };
        window.dispatchEvent(new PointerEvent('pointermove', opts));
        window.dispatchEvent(new PointerEvent('pointerup', opts));
      },
      { x: end.x, y: end.y, pointerType }
    );
  }

  test('offers a price marked on another chart, and copies it on a tap', async ({ page }) => {
    await gotoPlaybook(page);

    // Nothing to carry while the 15m is the chart on screen — it is the only line there is.
    await page.locator('#level-tf-15m').click();
    await page.locator('#level-prices-resistance').fill('7760');
    await page.locator('#level-add-both').click();
    await expect(page.locator('#level-carryover')).toHaveCount(0);

    // On the 5m the 15m line is offered, naming the chart it came from.
    await page.locator('#level-tf-5m').click();
    await expect(page.locator('#level-carryover')).toBeVisible();
    const chip = page.locator('[data-carryover="resistance|7760"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('15m');
    await expect(page.locator('[data-marked-level]')).toHaveCount(0);

    // One tap adds it to the chart on screen.
    await chip.click();
    await expect(page.locator('[data-marked-level]')).toHaveCount(1);
    await expect(
      page.locator('[data-marked-level]').first().getByText('7760.00', { exact: true })
    ).toBeVisible();
    // The offer is gone: the price now sits on this chart too.
    await expect(page.locator('#level-carryover')).toHaveCount(0);

    // It is a real level on the 5m, not a lifted line — it survives a reload.
    await page.reload();
    await gotoPlaybook(page);
    await expect(
      page.locator('[data-marked-level]').first().getByText('7760.00', { exact: true })
    ).toBeVisible();
  });

  // A finger and a mouse both drive the same Pointer Event path, so both are exercised here:
  // the touch case is what the phone sends, the mouse case is the desktop desk check.
  for (const pointerType of ['touch', 'mouse'] as const) {
    test(`takes the side of the box a carried price is dropped on with a ${pointerType}`, async ({
      page,
    }) => {
      await gotoPlaybook(page);
      await markFifteenThenOpenFive(page);

      await dragCarryChip(
        page,
        '[data-carryover="resistance|7760"]',
        '[data-carryover-drop="support"]',
        pointerType
      );

      // The box it landed on decides the side, so the copied line reads as support here.
      await expect(page.locator('[data-marked-level]')).toHaveCount(1);
      await expect(page.getByText('Support (1)')).toBeVisible();
      await expect(
        page.locator('[data-marked-level]').first().getByText('7760.00', { exact: true })
      ).toBeVisible();
    });
  }
});

/**
 * The timeframe edge scoreboard and its rolling read.
 *
 * The points here are the ones the record can honestly carry: a line counts as held when price
 * stays away three bars of its own chart, a return is judged on the exact time price came back,
 * and a hold called before the horizon elapsed is left out rather than counted against the line.
 * Seeded rather than tapped in, because the times are what the read is about.
 */
test.describe('Timeframe edge', () => {
  test('ranks the charts by their own horizon, and rolls the read over time', async ({ page }) => {
    await page.addInitScript(() => {
      const level = (id: string) => ({
        id,
        userId: 'solo-trader-01',
        tradingDayId: 'day-2026-09-28',
        tradeDate: '2026-09-28',
        instrumentId: 'mes',
        kind: 'resistance',
        price: 7760,
        zonePoints: 2,
        session: 'Regular Session',
        timeframe: '5m',
        createdAt: '2026-09-28T13:00:00.000Z',
        updatedAt: '2026-09-28T13:00:00.000Z',
      });
      const at = (hour: number, minute: number) =>
        `2026-09-28T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
      const base = (index: number, touchedAt: string) => ({
        id: `t${index}`,
        userId: 'solo-trader-01',
        tradingDayId: 'day-2026-09-28',
        tradeDate: '2026-09-28',
        instrumentId: 'mes',
        kind: 'resistance',
        price: 7760,
        zonePoints: 2,
        touchedAt,
        session: 'Regular Session',
        checks: 1,
        timeframe: '5m',
        levelId: index % 2 === 0 ? 'm1' : 'm2',
        createdAt: touchedAt,
        updatedAt: touchedAt,
      });
      // Eleven decided touches: the first six stayed away an hour, past the 15-minute horizon of
      // the 5m chart; the last five came back five minutes in, inside it. Enough for two
      // rolling windows of ten.
      const held = (index: number) => {
        const touchedAt = at(14, index * 5);
        return { ...base(index, touchedAt), outcome: 'never-returned', checkedAt: at(15, index * 5) };
      };
      const missed = (index: number) => {
        const minute = (index - 6) * 5;
        const touchedAt = at(16, minute);
        return { ...base(index, touchedAt), outcome: 'returned', returnedAt: at(16, minute + 5) };
      };

      localStorage.setItem('ptj_marked_levels_v1', JSON.stringify([level('m1'), level('m2')]));
      localStorage.setItem(
        'ptj_level_touches_v1',
        JSON.stringify([
          ...[1, 2, 3, 4, 5, 6].map(held),
          ...[7, 8, 9, 10, 11].map(missed),
        ])
      );
    });
    await page.reload();
    await gotoPlaybook(page);

    // The bucket is readable: six of eleven held the 15-minute horizon of the 5m chart.
    await expect(page.locator('#playbook-timeframe-edge')).toBeVisible();
    const row = page.locator('[data-timeframe-score="5m|resistance"]');
    await expect(row).toHaveAttribute('data-timeframe-score-enough', 'true');
    await expect(row).toContainText('held 54.5% of 11');
    // The plain hold rate is the other half of the story, and reads lower than the horizon rate.
    await expect(row).toContainText('never came back 54.5% (6/11)');
    await expect(row).toContainText('held ≥ 15 min');

    // The rolling read moves: the first window is 60%, the last loses one to a fast return.
    await expect(page.locator('[data-trend-line]')).toBeVisible();
    const read = page.locator('#timeframe-edge-trend-read');
    await expect(read).toContainText('first 60%');
    await expect(read).toContainText('last 50%');
    await expect(read).toContainText('10 pts');
  });

  test('says nothing rather than inventing a rate on a fresh journal', async ({ page }) => {
    await gotoPlaybook(page);
    await expect(page.locator('#timeframe-edge-empty')).toBeVisible();
    await expect(page.locator('#timeframe-edge-trend-empty')).toBeVisible();
    await expect(page.locator('[data-timeframe-score]')).toHaveCount(0);
    await expect(page.locator('[data-trend-line]')).toHaveCount(0);
  });
});

/**
 * The weekday narrowing on the level-odds card.
 *
 * The market is closed on Saturday, so offering it in the picker could only ever return an
 * empty read. The trading week runs Sunday evening to Friday, and both ends of it must stay.
 */
test.describe('Level odds — weekday narrowing', () => {
  test('offers the trading week and leaves Saturday out', async ({ page }) => {
    await gotoPlaybook(page);

    const weekday = page.locator('#level-odds-weekday');
    await expect(weekday.locator('option', { hasText: 'Sun' })).toHaveCount(1);
    await expect(weekday.locator('option', { hasText: 'Fri' })).toHaveCount(1);
    await expect(weekday.locator('option', { hasText: 'Sat' })).toHaveCount(0);
  });
});

/**
 * The level record drawn as charts: reach by symbol, the edge building, the touch timeline and
 * per-session coverage. One marked line and one decided touch is enough for every view to draw.
 */
test.describe('Level charts', () => {
  test('draws each view from the marked lines and touches', async ({ page }) => {
    // A marked-line record with decided touches, so every view has data to draw. Seeded
    // rather than tapped in, because the outcome of a touch is not set from the card.
    await page.addInitScript(() => {
      const level = (
        id: string,
        price: number,
        tradeDate: string,
        resolution?: 'never-touched' | 'void',
        instrumentId = 'mes'
      ) => ({
        id,
        userId: 'solo-trader-01',
        tradingDayId: `day-${tradeDate}`,
        tradeDate,
        instrumentId,
        kind: 'resistance',
        price,
        zonePoints: 2,
        session: 'Overnight',
        timeframe: '5m',
        resolution,
        createdAt: `${tradeDate}T02:00:00.000Z`,
        updatedAt: `${tradeDate}T02:00:00.000Z`,
      });
      const touch = (
        id: string,
        levelId: string,
        tradeDate: string,
        outcome: string,
        price: number,
        instrumentId = 'mes'
      ) => ({
        id,
        userId: 'solo-trader-01',
        tradingDayId: `day-${tradeDate}`,
        tradeDate,
        instrumentId,
        kind: 'resistance',
        price,
        zonePoints: 2,
        touchedAt: `${tradeDate}T02:00:00.000Z`,
        session: 'Overnight',
        outcome,
        checks: 0,
        levelId,
        createdAt: `${tradeDate}T02:00:00.000Z`,
        updatedAt: `${tradeDate}T02:00:00.000Z`,
      });

      localStorage.setItem(
        'ptj_marked_levels_v1',
        JSON.stringify([
          level('l1', 7760, '2026-09-28'),
          level('l2', 7775, '2026-09-28', 'never-touched'),
          level('l3', 7790, '2026-09-29'),
          // Enough MES 5 min resistance lines never reached for the "what to fix" callout to
          // clear its count floors and name this line rather than staying a tally.
          level('l4', 7805, '2026-09-30'),
          level('l5', 7820, '2026-10-01'),
          level('l6', 7835, '2026-10-02'),
          // A second contract, so the compare view has two sides. Kept under the fixup floors
          // so it does not displace the MES finding asserted below.
          level('n1', 20500, '2026-09-28', undefined, 'mnq'),
          level('n2', 20520, '2026-09-29', undefined, 'mnq'),
        ])
      );
      localStorage.setItem(
        'ptj_level_touches_v1',
        JSON.stringify([
          touch('t1', 'l1', '2026-09-28', 'never-returned', 7760),
          touch('t2', 'l3', '2026-09-29', 'returned', 7790),
          touch('t3', 'n1', '2026-09-28', 'returned', 20500, 'mnq'),
        ])
      );
    });
    await page.reload();
    await gotoPlaybook(page);

    // The card opens on coverage.
    await expect(page.locator('#playbook-level-charts')).toBeVisible();
    await expect(page.locator('#level-chart-coverage svg[role="application"]')).toBeVisible();

    // The record names the line the trader keeps marking that price never reaches.
    await expect(page.locator('#level-chart-what-to-fix')).toContainText('MES 5 min resistance');

    await page.locator('#level-chart-tab-edge').click();
    await expect(page.locator('#level-chart-edge svg[role="application"]')).toBeVisible();

    await page.locator('#level-chart-tab-timeline').click();
    await expect(page.locator('#level-chart-timeline svg[role="application"]')).toBeVisible();

    await page.locator('#level-chart-tab-sessions').click();
    await expect(page.locator('#level-chart-sessions svg[role="application"]')).toBeVisible();

    // Two contracts side by side, with the second selector defaulting to the other contract.
    await page.locator('#level-chart-tab-compare').click();
    await expect(page.locator('#level-chart-compare svg[role="application"]')).toBeVisible();
    await expect(page.locator('#level-chart-compare')).toContainText('MNQ');
    await expect(page.locator('#level-chart-compare')).toContainText('MES');

    // And it survives a reload, because it is drawn from the journal, not from React state.
    await page.reload();
    await gotoPlaybook(page);
    await expect(page.locator('#playbook-level-charts')).toBeVisible();
    await expect(page.locator('#level-chart-coverage svg[role="application"]')).toBeVisible();
  });
});

/**
 * The edge finder reading one instrument at a time.
 *
 * A trader who works one contract should not have their counts averaged across every line on
 * the record, so the finder leads with the day's own instrument — but the comparison and the
 * "all instruments" toggle must keep the rest visible, because that is how the choice is made.
 */
test.describe('Edge finder instrument focus', () => {
  test('reads the journal’s instrument by default and keeps the others a click away', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const level = (id: string, price: number, instrumentId: string) => ({
        id,
        userId: 'solo-trader-01',
        tradingDayId: 'day-2026-09-28',
        tradeDate: '2026-09-28',
        instrumentId,
        kind: 'resistance',
        price,
        zonePoints: 2,
        session: 'Overnight',
        timeframe: '5m',
        createdAt: '2026-09-28T02:00:00.000Z',
        updatedAt: '2026-09-28T02:00:00.000Z',
      });
      const touch = (id: string, levelId: string, price: number, instrumentId: string) => ({
        id,
        userId: 'solo-trader-01',
        tradingDayId: 'day-2026-09-28',
        tradeDate: '2026-09-28',
        instrumentId,
        kind: 'resistance',
        price,
        zonePoints: 2,
        touchedAt: '2026-09-28T02:00:00.000Z',
        session: 'Overnight',
        outcome: 'never-returned',
        checks: 0,
        levelId,
        createdAt: '2026-09-28T02:00:00.000Z',
        updatedAt: '2026-09-28T02:00:00.000Z',
      });

      localStorage.setItem(
        'ptj_marked_levels_v1',
        JSON.stringify([
          level('m1', 7760, 'mes'),
          level('m2', 7775, 'mes'),
          level('q1', 20500, 'mnq'),
        ])
      );
      localStorage.setItem(
        'ptj_level_touches_v1',
        JSON.stringify([
          touch('t1', 'm1', 7760, 'mes'),
          touch('t2', 'q1', 20500, 'mnq'),
        ])
      );
    });
    await page.reload();
    await gotoPlaybook(page);

    // The card opens on the journal's own contract, scoped to MES alone.
    await expect(page.locator('#playbook-edge-scope')).toBeVisible();
    await expect(page.locator('#edge-scope-focus')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-timeframe-bucket="mes|5m|resistance"]')).toHaveCount(1);
    await expect(page.locator('[data-timeframe-bucket="mnq|5m|resistance"]')).toHaveCount(0);

    // The comparison still shows the whole record, MES badged as the focus.
    await expect(page.locator('#playbook-edge-instruments')).toBeVisible();
    await expect(
      page.locator('#playbook-edge-instruments [data-instrument-bucket="mes"]')
    ).toContainText('focus');
    await expect(
      page.locator('#playbook-edge-instruments [data-instrument-bucket="mnq"]')
    ).toBeVisible();

    // Widening to every instrument brings the other contract's lines back into the read.
    await page.locator('#edge-scope-all').click();
    await expect(page.locator('#edge-scope-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-timeframe-bucket="mnq|5m|resistance"]')).toHaveCount(1);
  });
});

/**
 * Attaching reference charts and video clips to a setup.
 *
 * The upload path was shipping uncovered, which matters because a setup's media is
 * written into the journal snapshot: if it silently failed to save, the card would look
 * right until the next reload.
 */
test.describe('Setup charts & video attachments', () => {
  /** A real 1x1 PNG — the compressor reads it through an <img>, so it must decode. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  async function openResistanceEditor(page: Page) {
    await gotoPlaybook(page);
    await revealAllSetups(page);
    const card = setupCard(page, 'Resistance');
    await card.getByTitle('Edit setup, rules, charts and video').click();
    await expect(page.getByRole('heading', { name: /Edit Setup: Resistance/i })).toBeVisible();
    return card;
  }

  test('the setup editor accepts screenshots and video clips', async ({ page }) => {
    await openResistanceEditor(page);

    // The file picker must offer both kinds, or a clip can never be chosen.
    await expect(page.locator('#setup-modal-images-file-input')).toHaveAttribute(
      'accept',
      /image\/\*.*video\/\*/i
    );
    await expect(page.locator('#setup-modal-images-container')).toContainText(
      '0 / 6 attached'
    );
  });

  test('attaches a chart to a setup and shows it on the card, after a reload', async ({ page }) => {
    const card = await openResistanceEditor(page);

    await page
      .locator('#setup-modal-images-file-input')
      .setInputFiles({ name: 'resistance-example.png', mimeType: 'image/png', buffer: PNG });

    await expect(page.locator('#setup-modal-images-container')).toContainText('1 / 6 attached');

    await page.getByRole('button', { name: /Update Setup/i }).click();

    // The card advertises the attachment rather than hiding it in the editor.
    await expect(card.getByText(/Playbook Charts & Video \(1\)/)).toBeVisible();

    // The real test: it is in the journal, not just React state. A reload lands back on
    // the Today tab, so the Playbook has to be reopened before the card exists again.
    await page.reload();
    await gotoPlaybook(page);
    await expect(setupCard(page, 'Resistance').getByText(/Playbook Charts & Video \(1\)/)).toBeVisible();
  });

  test('opens the attached chart in the lightbox from the card', async ({ page }) => {
    const card = await openResistanceEditor(page);

    await page
      .locator('#setup-modal-images-file-input')
      .setInputFiles({ name: 'resistance-example.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: /Update Setup/i }).click();

    await card.getByTitle(/Click to view chart screenshot big/i).click();

    await expect(page.locator('#image-lightbox-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Resistance Setup Playbook/i })).toBeVisible();
    await page.locator('#lightbox-close-button').click();
    await expect(page.locator('#image-lightbox-overlay')).toHaveCount(0);
  });

  test('a setup can hold several charts and they all survive a save', async ({ page }) => {
    const card = await openResistanceEditor(page);

    await page.locator('#setup-modal-images-file-input').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: PNG },
      { name: 'b.png', mimeType: 'image/png', buffer: PNG },
      { name: 'c.png', mimeType: 'image/png', buffer: PNG },
    ]);

    await expect(page.locator('#setup-modal-images-container')).toContainText('3 / 6 attached');
    await page.getByRole('button', { name: /Update Setup/i }).click();

    await expect(card.getByText(/Playbook Charts & Video \(3\)/)).toBeVisible();
  });
});
