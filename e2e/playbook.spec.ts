import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke tests for the Playbook tab.
 *
 * The app boots local-only (no Supabase in the test env), so the default
 * seed applies: 7 setups (Engulfing, Support, Resistance, Breakout,
 * Reversal, Trend Continuation, Other) and a fresh trading day whose
 * watchedSetups are ['Engulfing', 'Support', 'Resistance'].
 */

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
  // Deterministic local state: fresh journal every test run.
  await page.addInitScript(() => {
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
