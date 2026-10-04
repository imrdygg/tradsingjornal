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
    await expect(row.getByText('7788', { exact: true })).toBeVisible();
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
