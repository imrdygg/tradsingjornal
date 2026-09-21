import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_SETUPS } from '../src/lib/storage';

/**
 * Smoke tests for the Playbook tab.
 *
 * The app boots local-only (no Supabase in the test env), so a fresh journal gets the
 * whole built-in catalog (DEFAULT_SETUPS — 32 setups) and a trading day whose
 * watchedSetups are ['Engulfing', 'Support', 'Resistance'].
 */

/** One example chart, which draws its dashed level as a 4-3 line. */
const DIAGRAM_WITH_LEVEL = 'svg[role="img"] line[stroke-dasharray="4 3"]';

const ENGULFING_SUMMARY =
  'A two-candle reversal pattern where one candle fully "swallows" the body of the previous one';

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
  test('shows the library with all default setups', async ({ page }) => {
    await gotoPlaybook(page);

    for (const name of [
      'Engulfing',
      'Support',
      'Resistance',
      'Breakout',
      'Reversal',
      'Trend Continuation',
      'Other',
    ]) {
      // Addressed by title rather than by text: a folded card keeps its study guide in
      // the DOM, and the Support/Resistance diagrams label their dashed level with the
      // same word, so a bare text match is ambiguous. The name element is what this
      // asserts about, and it is the element that carries the title.
      //
      // `exact` is required: a title match is a substring match, so plain 'Breakout'
      // also resolves to 'Opening Range Breakout' and 'Failed Breakout'.
      await expect(page.getByTitle(name, { exact: true })).toBeVisible();
    }
  });

  test('the whole card toggles the study guide, not just its icon', async ({ page }) => {
    await gotoPlaybook(page);

    // Breakout has no dashed-level label that could collide with its name.
    const card = page
      .locator('div.rounded-2xl', { has: page.getByTitle('Breakout', { exact: true }) })
      .first();
    const guide = card.getByText('How this setup forms');

    // Folded to start with, and hidden rather than merely clipped.
    await expect(card.getByTitle('Show study guide')).toHaveAttribute('aria-expanded', 'false');
    await expect(guide).toBeHidden();

    // Clicking the setup name — not a button, not an icon — unfolds the guide.
    await card.getByTitle('Breakout', { exact: true }).click();
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
    await expect(page.getByText(ENGULFING_SUMMARY, { exact: false })).toBeVisible();

    // Open the Engulfing study guide via its book (expand) button.
    const engulfingCard = page.locator('div.rounded-2xl', { has: page.getByText('Engulfing', { exact: true }) }).first();
    await engulfingCard.getByTitle('Show study guide').click();

    await expect(engulfingCard.getByText('How this setup forms')).toBeVisible();
    await expect(engulfingCard.getByText('How to trade it')).toBeVisible();
    await expect(engulfingCard.getByText(/Invalidation/)).toBeVisible();

    // Green/red example diagrams render (bullish + bearish SVG charts).
    const diagrams = engulfingCard.locator('svg[role="img"]');
    await expect(diagrams).toHaveCount(2);
    await expect(engulfingCard.getByText(/Green — bullish example/i)).toBeVisible();
    await expect(engulfingCard.getByText(/Red — bearish example/i)).toBeVisible();

    // Collapse again.
    await engulfingCard.getByTitle('Hide study guide').click();
    await expect(engulfingCard.getByText('How this setup forms')).toBeHidden();
  });

  test('every built-in setup draws both examples with its dashed level', async ({ page }) => {
    await gotoPlaybook(page);

    // Driven from the catalog rather than from a list written out here, so a setup added
    // later without a level line fails this test instead of shipping a chart that shows
    // candles moving without the price the setup is waiting on.
    for (const setup of DEFAULT_SETUPS) {
      const card = page
        .locator('div.rounded-2xl', { has: page.getByTitle(setup.name, { exact: true }) })
        .first();

      // One bullish and one bearish example, each with its level.
      await expect(card.locator('svg[role="img"]')).toHaveCount(2);
      await expect(card.locator(DIAGRAM_WITH_LEVEL)).toHaveCount(2);
    }
  });

  test('the added setups bring their guide and label the level they wait on', async ({ page }) => {
    await gotoPlaybook(page);

    const card = page
      .locator('div.rounded-2xl', { has: page.getByTitle('Gap and Go', { exact: true }) })
      .first();
    await card.getByTitle('Show study guide').click();

    await expect(card.getByText('How this setup forms')).toBeVisible();
    await expect(card.getByText('How to trade it')).toBeVisible();
    await expect(card.getByText(/Invalidation/)).toBeVisible();

    // The level is not just drawn, it is named: both examples label the gap edge.
    await expect(card.locator('svg[role="img"] text')).toHaveCount(2);
    await expect(card.locator('svg[role="img"] text').first()).toHaveText('Gap edge');
    await expect(card.locator('svg[role="img"] text').last()).toHaveText('Gap edge');
  });

  test('a custom setup gets the generic examples rather than an empty space', async ({ page }) => {
    await gotoPlaybook(page);

    await page.getByPlaceholder(/Fair Value Gap/).fill('My Own Setup');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const card = page
      .locator('div.rounded-2xl', { has: page.getByTitle('My Own Setup', { exact: true }) })
      .first();

    // A setup the catalog has never heard of still shows a chart with a level, and says
    // plainly that the chart is generic so it is not read as a picture of their setup.
    await expect(card.locator(DIAGRAM_WITH_LEVEL)).toHaveCount(2);
    await card.getByTitle('Show study guide').click();
    await expect(card.getByText(/generic rising and\s+falling examples/i)).toBeVisible();
  });

  test('default watched setups are highlighted with a clickable badge', async ({ page }) => {
    await gotoPlaybook(page);

    // The seeded day watches Engulfing, Support and Resistance.
    for (const name of ['Engulfing', 'Support', 'Resistance']) {
      const card = page.locator('div.rounded-2xl', { has: page.getByText(name, { exact: true }) }).first();
      await expect(card.getByText('Watched today')).toBeVisible();
    }
    // Unwatched setups must not show the badge.
    await expect(page.getByText('Watched today')).toHaveCount(3);

    // The badge is a button that opens the study guide.
    const supportCard = page.locator('div.rounded-2xl', { has: page.getByText('Support', { exact: true }) }).first();
    await supportCard.getByText('Watched today').click();
    await expect(supportCard.getByText('How this setup forms')).toBeVisible();
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

  async function openBreakoutEditor(page: Page) {
    await gotoPlaybook(page);
    const card = page
      .locator('div.rounded-2xl', { has: page.getByTitle('Breakout', { exact: true }) })
      .first();
    await card.getByTitle('Edit setup, rules, charts and video').click();
    await expect(page.getByRole('heading', { name: /Edit Setup: Breakout/i })).toBeVisible();
    return card;
  }

  test('the setup editor accepts screenshots and video clips', async ({ page }) => {
    await openBreakoutEditor(page);

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
    const card = await openBreakoutEditor(page);

    await page
      .locator('#setup-modal-images-file-input')
      .setInputFiles({ name: 'breakout-example.png', mimeType: 'image/png', buffer: PNG });

    await expect(page.locator('#setup-modal-images-container')).toContainText('1 / 6 attached');

    await page.getByRole('button', { name: /Update Setup/i }).click();

    // The card advertises the attachment rather than hiding it in the editor.
    await expect(card.getByText(/Playbook Charts & Video \(1\)/)).toBeVisible();

    // The real test: it is in the journal, not just React state. A reload lands back on
    // the Today tab, so the Playbook has to be reopened before the card exists again.
    await page.reload();
    await gotoPlaybook(page);
    const reloadedCard = page
      .locator('div.rounded-2xl', { has: page.getByTitle('Breakout', { exact: true }) })
      .first();
    await expect(reloadedCard.getByText(/Playbook Charts & Video \(1\)/)).toBeVisible();
  });

  test('opens the attached chart in the lightbox from the card', async ({ page }) => {
    const card = await openBreakoutEditor(page);

    await page
      .locator('#setup-modal-images-file-input')
      .setInputFiles({ name: 'breakout-example.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: /Update Setup/i }).click();

    await card.getByTitle(/Click to view chart screenshot big/i).click();

    await expect(page.locator('#image-lightbox-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Breakout Setup Playbook/i })).toBeVisible();
    await page.locator('#lightbox-close-button').click();
    await expect(page.locator('#image-lightbox-overlay')).toHaveCount(0);
  });

  test('a setup can hold several charts and they all survive a save', async ({ page }) => {
    const card = await openBreakoutEditor(page);

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

test.describe('Playbook deep-link', () => {
  test('Morning Plan "Study in Playbook" opens the tab focused on watched setups', async ({ page }) => {
    // Start on Today where the Morning Plan lives.
    await expect(page.getByRole('heading', { name: /Morning Plan/i })).toBeVisible();

    // Watched setups are seeded as Engulfing/Support/Resistance; make the
    // watch list deterministic by asserting the link exists, then click it.
    await page.getByRole('button', { name: /Study in Playbook/i }).click();

    await expect(page.getByRole('heading', { name: /Trading Setups & Playbook Library/i })).toBeVisible();

    // The focused cards are expanded to their study guides and highlighted.
    const engulfingCard = page.locator('div.rounded-2xl', { has: page.getByText('Engulfing', { exact: true }) }).first();
    await expect(engulfingCard.getByText('How this setup forms')).toBeVisible();
    await expect(engulfingCard.locator('svg[role="img"]')).toHaveCount(2);
  });

  test('watched-setups changes on the plan are reflected in the Playbook badge', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Morning Plan/i })).toBeVisible();

    // Add Breakout to today's watch list from the plan form.
    await page.getByRole('button', { name: 'Breakout', exact: true }).first().click();
    await page.getByRole('button', { name: /Study in Playbook/i }).click();

    const breakoutCard = page.locator('div.rounded-2xl', { has: page.getByText('Breakout', { exact: true }) }).first();
    await expect(breakoutCard.getByText('Watched today')).toBeVisible();
    await expect(breakoutCard.getByText('How this setup forms')).toBeVisible();
  });
});
