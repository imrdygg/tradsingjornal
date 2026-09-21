import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for Playbook > Chart Patterns.
 *
 * The unit tests prove the data is complete and the geometry is in range; these prove the
 * section actually works in a browser — that the grid, the filters, the staged
 * illustration, the study journal and the per-pattern URL are all reachable and that
 * anything the trader writes is still there after a reload.
 *
 * The app boots local-only here (Supabase env is stripped by the Playwright config), so a
 * cleared localStorage gives the default journal.
 */

const DOUBLE_TOP = 'reversal-bearish-double-top';
const FALLING_VILLAGE = 'continuation-bullish-falling-village';

/** A real 1x1 PNG: the uploader compresses through an <img>, so it must decode. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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

async function gotoChartPatterns(page: Page) {
  await gotoPlaybook(page);
  await page.locator('#playbook-tab-patterns').click();
  await expect(page.locator('#chart-patterns-section')).toBeVisible();
}

async function openPattern(page: Page, patternId: string) {
  await page.locator(`#pattern-study-${patternId}`).click();
  await expect(page.locator(`#pattern-detail-${patternId}`)).toBeVisible();
}

const cardCount = (page: Page) => page.locator('[id^="pattern-card-"]');

test.beforeEach(async ({ page }) => {
  // A fresh journal per test. Guarded by sessionStorage because an init script runs on
  // every navigation, so an unguarded clear would wipe the data on reload and no test
  // could assert that anything persisted.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ptj_e2e_cleared')) return;
    sessionStorage.setItem('ptj_e2e_cleared', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test.describe('Chart Patterns grid', () => {
  test('shows all 20 source setups in source order, each with an illustration', async ({ page }) => {
    await gotoChartPatterns(page);

    await expect(cardCount(page)).toHaveCount(20);

    // Source order, not alphabetical: the sheet's sequence is the intended study order.
    const first = page.locator(`#pattern-card-${DOUBLE_TOP}`);
    await expect(first).toContainText('Bearish Double Top');
    await expect(first.locator('svg[role="img"]')).toHaveCount(1);

    const last = page.locator('#pattern-card-continuation-symmetrical-expanding-triangle-bearish-source');
    await expect(last).toContainText('Symmetrical Expanding Triangle — bearish / lower source illustration');

    // Both rows are represented, with their direction labelled.
    await expect(page.locator(`#pattern-card-${DOUBLE_TOP}`)).toContainText('Reversal');
    await expect(page.locator(`#pattern-card-${DOUBLE_TOP}`)).toContainText('Bearish');
    await expect(page.locator('#pattern-card-continuation-symmetrical-expanding-triangle-upper-source')).toContainText(
      'Two-direction'
    );
  });

  test('filters by category and by bias, and combines the two', async ({ page }) => {
    await gotoChartPatterns(page);

    await page.locator('#pattern-filter-category-reversal').click();
    await expect(cardCount(page)).toHaveCount(10);
    await expect(page.locator('#pattern-card-continuation-bullish-flag')).toHaveCount(0);

    await page.locator('#pattern-filter-category-continuation').click();
    await expect(cardCount(page)).toHaveCount(10);
    await expect(page.locator(`#pattern-card-${DOUBLE_TOP}`)).toHaveCount(0);

    await page.locator('#pattern-filter-category-all').click();
    await page.locator('#pattern-filter-bias-bullish').click();
    await expect(cardCount(page)).toHaveCount(9);

    await page.locator('#pattern-filter-bias-neutral').click();
    await expect(cardCount(page)).toHaveCount(1);
    await expect(page.locator('#pattern-card-continuation-symmetrical-expanding-triangle-upper-source')).toBeVisible();

    // A combination that genuinely narrows: continuation + bearish.
    await page.locator('#pattern-filter-category-continuation').click();
    await page.locator('#pattern-filter-bias-bearish').click();
    await expect(cardCount(page)).toHaveCount(5);

    // And a combination that matches nothing says so instead of showing an empty page.
    // The only two-direction setup is a continuation, so reversal + neutral is empty.
    await page.locator('#pattern-filter-category-reversal').click();
    await page.locator('#pattern-filter-bias-neutral').click();
    await expect(cardCount(page)).toHaveCount(0);
    await expect(page.locator('#chart-patterns-section')).toContainText('No patterns match those filters');

    // The two-direction setup is the only neutral one, so it is reachable by filter alone.
    await page.locator('#pattern-filter-category-all').click();
    await expect(cardCount(page)).toHaveCount(1);
  });

  test('says chart patterns are educational, not signals', async ({ page }) => {
    await gotoChartPatterns(page);
    await expect(page.locator('#chart-patterns-section')).toContainText(/not guarantees and not signals/i);
    await expect(page.locator('#chart-patterns-section')).toContainText(/measured move is a reference/i);
  });
});

test.describe('Pattern study guide', () => {
  test('opens every documented section in order', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    const detail = page.locator(`#pattern-detail-${DOUBLE_TOP}`);

    for (const heading of [
      'Quick definition',
      'Market story',
      'What must be present',
      'Formation sequence',
      'Confirmation / trigger',
      'Invalidation / failure signs',
      'Potential target concepts',
      'Common mistakes',
      'Playbook checklist',
      'My screenshots / examples',
      'My notes',
      'Related setups',
    ]) {
      await expect(detail.getByText(heading, { exact: true })).toBeVisible();
    }

    // The order is the spec's order, checked by position rather than by presence: a
    // section that drifted below the notes would still "be visible".
    const y = async (text: string) =>
      (await detail.getByText(text, { exact: true }).boundingBox())?.y ?? 0;
    expect(await y('Quick definition')).toBeLessThan(await y('Market story'));
    expect(await y('Market story')).toBeLessThan(await y('What must be present'));
    // These two share a row on a wide screen, so equality is the correct expectation here.
    expect(await y('Confirmation / trigger')).toBeLessThanOrEqual(await y('Invalidation / failure signs'));
    expect(await y('Invalidation / failure signs')).toBeLessThan(await y('Potential target concepts'));
    expect(await y('Common mistakes')).toBeLessThan(await y('Playbook checklist'));
    expect(await y('Playbook checklist')).toBeLessThan(await y('My notes'));
    expect(await y('My notes')).toBeLessThan(await y('Related setups'));
  });

  test('teaches the formation in stages rather than drawing a finished chart', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    const detail = page.locator(`#pattern-detail-${DOUBLE_TOP}`);
    const play = page.locator(`#pattern-play-${DOUBLE_TOP}`);

    // Autoplay opens on the prior trend, then reveals the pattern as the cycle advances.
    await expect(detail.getByText(/1\. Prior trend/)).toBeVisible();
    await expect(play).toContainText('Pause');

    await play.click();
    await expect(play).toContainText('Play');
    const paused = await detail.getByRole('progressbar').getAttribute('aria-valuenow');
    await page.waitForTimeout(500);
    expect(await detail.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(paused);

    // Resuming restarts the storyboard from the beginning, so the caption moves on again.
    // Matched on the numbered caption: the status picker also offers a "Breakout attempted"
    // option, so a bare /Breakout/ would resolve to two different elements.
    await play.click();
    await expect(
      detail.getByText(/[2-4]\. (Pattern forming|Structure completing|Breakout \/ breakdown)/)
    ).toBeVisible({ timeout: 6000 });

    // Every annotation is optional, because the whole point is to study one thing at a time.
    for (const toggle of ['Labels', 'Retest', 'Target']) {
      const button = detail.getByRole('button', { name: toggle, exact: true });
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }

    await detail.getByRole('button', { name: 'Replay' }).click();
    await expect(play).toContainText('Pause');
  });

  test('stays still for a reduced-motion reader until they ask for it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    const detail = page.locator(`#pattern-detail-${DOUBLE_TOP}`);
    await expect(detail.getByText(/Reduced motion is on/i)).toBeVisible();
    // No unsolicited motion: it opens paused, on the finished chart.
    await expect(page.locator(`#pattern-play-${DOUBLE_TOP}`)).toContainText('Play');
    await expect(detail.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('preserves the source label where the sheet contradicts itself', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, FALLING_VILLAGE);

    const detail = page.locator(`#pattern-detail-${FALLING_VILLAGE}`);
    await expect(detail).toContainText('Source note');
    await expect(detail).toContainText('not a standard chart-pattern name');
    await expect(detail).toContainText('Falling consolidation / bullish channel-style continuation');

    // The second card carrying a repeated label names its source label explicitly.
    await detail.getByRole('button', { name: 'Close pattern' }).click();
    await openPattern(page, 'continuation-descending-triangle-bearish-source');
    const second = page.locator('#pattern-detail-continuation-descending-triangle-bearish-source');
    await expect(second).toContainText('Source label: Descending Triangle');
    await expect(second).toContainText('Preserved as printed');
  });

  test('moves between related setups', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    const detail = page.locator(`#pattern-detail-${DOUBLE_TOP}`);
    // Double tops and double bottoms are the same idea read from opposite sides, so this
    // pairing is the point of the section rather than an incidental similarity.
    await detail.getByRole('button', { name: /Bullish Double Bottom/ }).click();

    await expect(page.locator('#pattern-detail-reversal-bullish-double-bottom')).toBeVisible();
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toHaveCount(0);
  });

  test('closes with Escape and gives focus back to the card', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    await page.keyboard.press('Escape');
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toHaveCount(0);
    await expect(page.locator(`#pattern-study-${DOUBLE_TOP}`)).toBeFocused();
  });
});

test.describe('Study journal', () => {
  test('keeps the status, checklist and notes after a reload', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    await page.locator('#pattern-check-universal-0').click();
    await expect(page.locator('#pattern-check-universal-0')).toHaveAttribute('aria-pressed', 'true');

    // The status picker states what the evidence actually is, not what is hoped for.
    await page.locator(`#pattern-status-${DOUBLE_TOP}`).selectOption('confirmed');
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toContainText(
      'A candle CLOSED beyond the structure.'
    );

    await page.locator('#pattern-notes').fill('Looks like the August top on MES.');
    await page.locator('#pattern-save-notes').click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);

    // The notes are saved; an unrelated pattern must not inherit them.
    await page.reload();
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toBeVisible();
    await expect(page.locator('#pattern-notes')).toHaveValue('Looks like the August top on MES.');
    await expect(page.locator('#pattern-check-universal-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`#pattern-status-${DOUBLE_TOP}`)).toHaveValue('confirmed');

    // The grid shows where the study got to, so progress is visible without opening it.
    await page.locator(`#pattern-detail-${DOUBLE_TOP}`).getByRole('button', { name: 'Close pattern' }).click();
    await expect(page.locator(`#pattern-card-${DOUBLE_TOP}`)).toContainText('Confirmed');
    await openPattern(page, DOUBLE_TOP);

    await page.locator(`#pattern-detail-${DOUBLE_TOP}`).getByRole('button', { name: 'Close pattern' }).click();
    await openPattern(page, 'reversal-bearish-triple-top');
    await expect(page.locator('#pattern-notes')).toHaveValue('');
  });

  test('logs an example with screenshots that survives a reload', async ({ page }) => {
    await gotoChartPatterns(page);

    // The card's "Add example" action opens the guide with the entry editor already out,
    // so logging an example is one click from the grid rather than a hunt inside the guide.
    await page.locator(`#pattern-add-example-${DOUBLE_TOP}`).click();
    const detail = page.locator(`#pattern-detail-${DOUBLE_TOP}`);
    await expect(detail.getByText('Screenshot before entry')).toBeVisible();

    await page.getByPlaceholder('MES').fill('ES');
    await page.getByPlaceholder('5m').fill('15m');
    await page.getByPlaceholder('What the chart showed.').fill('Second test of the same session high.');

    await page
      .locator('[id^="pattern-before-"][id$="-file-input"]')
      .setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('[id^="pattern-before-"][id$="-container"]')).toContainText(
      '1 / 1 attached'
    );

    await detail.getByRole('button', { name: 'Save example' }).click();

    // The saved example is readable on the card, then still there after a reload.
    await expect(detail).toContainText('ES');
    await expect(detail).toContainText('15m');
    await expect(detail).toContainText('Second test of the same session high.');

    await page.reload();
    const reopened = page.locator(`#pattern-detail-${DOUBLE_TOP}`);
    await expect(reopened).toContainText('Second test of the same session high.');

    // The grid advertises that this pattern now has study material.
    await reopened.getByRole('button', { name: 'Close pattern' }).click();
    await expect(page.locator(`#pattern-card-${DOUBLE_TOP}`)).toContainText('example');

    // A logged chart opens in the lightbox rather than staying a thumbnail.
    await openPattern(page, DOUBLE_TOP);
    await page.locator('[id^="pattern-entry-"] img').first().click();
    await expect(page.locator('#image-lightbox-overlay')).toBeVisible();
    await page.locator('#lightbox-close-button').click();
    await expect(page.locator('#image-lightbox-overlay')).toHaveCount(0);
  });
});

test.describe('Per-pattern URL', () => {
  test('opens a pattern straight from its link, and clears it on close', async ({ page }) => {
    await page.goto(`/#chart-patterns/${FALLING_VILLAGE}`);

    // The link lands on the Playbook tab with the pattern already open.
    await expect(page.locator(`#pattern-detail-${FALLING_VILLAGE}`)).toBeVisible();

    await page.locator(`#pattern-detail-${FALLING_VILLAGE}`).getByRole('button', { name: 'Close pattern' }).click();
    await expect(page.locator(`#pattern-detail-${FALLING_VILLAGE}`)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('');
  });

  test('writes the link when a pattern is opened from the grid', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, DOUBLE_TOP);

    expect(new URL(page.url()).hash).toBe(`#chart-patterns/${DOUBLE_TOP}`);

    await page.reload();
    await expect(page.locator(`#pattern-detail-${DOUBLE_TOP}`)).toBeVisible();
  });

  test('falls back to the grid for a link that names nothing', async ({ page }) => {
    await page.goto('/#chart-patterns/not-a-pattern');

    await expect(page.locator('#chart-patterns-section')).toBeVisible();
    await expect(cardCount(page)).toHaveCount(20);
    await expect(page.locator('[id^="pattern-detail-"]')).toHaveCount(0);
  });
});

test.describe('Link from a trade', () => {
  test('a trade logged under a pattern name leads to that pattern study guide', async ({ page }) => {
    // Log the setup under the exact source label so the match is exact, not a guess.
    await gotoPlaybook(page);
    await page.getByPlaceholder(/Fair Value Gap/).fill('Bullish Flag Pattern');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const today = page.locator('#nav-btn-today');
    if (await today.isVisible()) await today.click();
    else await page.locator('#mobile-nav-today').click();

    await page.locator('#btn-add-trade-top').click();
    await page.locator('#trade-setup-select').selectOption({ label: 'Bullish Flag Pattern' });
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.locator('#trade-exit-price').fill('7740');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    await page.getByText('MES (1x)').first().click();
    await page.locator('#trade-study-pattern').click();

    // The guide opens instead of the trade: one dialog at a time, on the right pattern.
    await expect(page.locator('#pattern-detail-continuation-bullish-flag')).toBeVisible();
    await expect(page.locator('#pattern-detail-continuation-bullish-flag')).toContainText(
      'A strong bullish impulse followed by a smaller'
    );
  });

  test('a trade whose setup is not a pattern offers no link', async ({ page }) => {
    await page.locator('#btn-add-trade-top').click();
    await page.locator('#trade-entry-price').fill('7730');
    await page.locator('#trade-initial-stop').fill('7710');
    await page.locator('#trade-contracts').fill('1');
    await page.locator('#trade-exit-price').fill('7740');
    await page.getByRole('button', { name: /Save Completed Trade/i }).click();

    // The seeded default setup is 'Engulfing', which is not a chart pattern here, so the
    // button must be absent rather than pointing at a near-match.
    await page.getByText('MES (1x)').first().click();
    await expect(page.locator('#trade-study-pattern')).toHaveCount(0);
  });
});

test.describe('Layout', () => {
  test('fits the viewport with a guide open, without sideways scrolling', async ({ page }) => {
    await gotoChartPatterns(page);
    await openPattern(page, FALLING_VILLAGE);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // The illustration scales instead of being cropped, so it stays readable on a phone.
    const illustration = page.locator(`#pattern-detail-${FALLING_VILLAGE} svg[role="img"]`).first();
    const box = await illustration.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    expect(box!.height).toBeGreaterThan(80);
  });
});
