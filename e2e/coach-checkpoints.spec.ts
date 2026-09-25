import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the two daily coach checkpoints on the Today tab:
 *  - the card is present without navigating, and names the active checkpoint
 *  - the trader can switch to the other checkpoint and back
 *  - nothing is requested until asked, and a failure leaves a way to retry
 *
 * Which checkpoint is auto-selected depends on the wall clock, so these specs never
 * assert one specific checkpoint. The window boundaries themselves are covered by
 * unit tests in src/lib/ai/__tests__/checkpoints.test.ts, where the clock can be fixed.
 */

const ANY_CHECKPOINT = /Pre-session prep|Post-session review/;

/**
 * The Today tab opens on the day's trades alone. The coach checkpoints — the whole subject
 * of this file — live in the folded "Plan, risk, coach & search" section with the plan, so
 * every test here unfolds it before the card is reachable.
 */
async function expandTodayAdvanced(page: Page) {
  // Addressed by the body it controls, not by aria-expanded: the section holds other
  // collapsibles, so "any collapsed button inside it" is not the section's own toggle.
  const toggle = page.locator('button[aria-controls="section-today-advanced-body"]').first();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
  await expandTodayAdvanced(page);
});

test.describe('Coach checkpoints on Today', () => {
  test('appears on the Today tab without navigating, naming the active checkpoint', async ({
    page,
  }) => {
    await expect(page.locator('#coach-checkpoint-card')).toBeVisible();
    await expect(page.locator('#coach-checkpoint-label')).toHaveText(ANY_CHECKPOINT);
    await expect(page.locator('#coach-checkpoint-evidence')).toBeVisible();
  });

  test('states that it reads only the journal, with no market data', async ({ page }) => {
    await expect(
      page.getByText(/Reads only your journal — no market data or predictions/i)
    ).toBeVisible();
  });

  test('reports the window so the schedule is never a mystery', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');

    // The header chip shows the active window...
    await expect(card.getByText(/(08:00–16:00|16:00–08:00)/).first()).toBeVisible();
    // ...and the schedule line states both boundaries.
    await expect(card.locator('#coach-checkpoint-schedule')).toContainText('08:00–16:00');
    await expect(card.locator('#coach-checkpoint-schedule')).toContainText('16:00–08:00');
    await expect(card.locator('#coach-checkpoint-schedule')).toContainText(/local time/i);
  });

  test('generates nothing on load, then reports honestly when the service is unavailable', async ({
    page,
  }) => {
    const card = page.locator('#coach-checkpoint-card');
    await expect(card).toBeVisible();

    // Nothing has been written before the trader asks.
    await expect(card.locator('#coach-checkpoint-result')).toHaveCount(0);
    await expect(card.locator('#coach-error-checkpoint')).toHaveCount(0);

    await card.locator('#coach-checkpoint-generate').click();

    // Ids follow the coach-error-* convention used by the Coach tab.
    const error = card.locator('#coach-error-checkpoint');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Coach not available here/i);
    await expect(card.locator('#coach-checkpoint-result')).toHaveCount(0);
  });

  test('leaves a retry available after a failed attempt', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');
    const button = card.locator('#coach-checkpoint-generate');

    await button.click();
    await expect(card.locator('#coach-error-checkpoint')).toBeVisible();

    // The button must survive the failure, relabelled, rather than leaving a dead end.
    await expect(button).toBeVisible();
    await expect(button).toHaveText(/Try again/i);
  });

  test('switches to the other checkpoint and back to the current one', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');
    const label = card.locator('#coach-checkpoint-label');
    const switcher = card.locator('#coach-checkpoint-switch');

    await expect(label).toHaveText(ANY_CHECKPOINT);
    const active = (await label.textContent())?.trim() ?? '';
    const other = active === 'Pre-session prep' ? 'Post-session review' : 'Pre-session prep';

    await switcher.click();
    await expect(label).toHaveText(other);
    await expect(switcher).toHaveText(/Back to now/i);
    // The action button follows the switched checkpoint.
    await expect(card.locator('#coach-checkpoint-generate')).toBeVisible();

    await switcher.click();
    await expect(label).toHaveText(active);
  });

  test('shows the evidence grade from the journal without any AI call', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');

    // An empty journal is honestly labelled as thin evidence, computed locally.
    await expect(card.locator('#coach-checkpoint-evidence')).toHaveText(/Thin evidence/i);
    await expect(card.getByText(/0 closed/)).toBeVisible();
    await expect(card.getByText(/0 reviewed/)).toBeVisible();
  });
});

const SEEDED_HEADLINE = 'Seeded headline for the written-note spec';
const CHECKPOINT_CACHE_KEY = 'ptj_coach_checkpoints_v1';

/**
 * Writes a saved note straight into the coach cache, using the exact shape
 * `writeCachedNote` stores. The dev server has no serverless function, so a note can
 * never be generated in these specs — but the cache is what the card reads, so seeding
 * it is the only way to exercise what a written note looks like.
 *
 * Both checkpoints are seeded because which one is active depends on the wall clock.
 * Nothing is asserted about the generated text: these specs only cover folding the
 * output away and asking for it again.
 */
async function seedCachedNotes(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, headline }) => {
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const generatedAt = new Date().toISOString();
      // Deliberately stale: an out-of-date note must still render, just labelled.
      const fingerprint = 'seeded';

      const notes = {
        [`${date}:prep`]: {
          checkpoint: 'prep',
          date,
          generatedAt,
          fingerprint,
          data: {
            headline,
            yesterdayLesson: 'You chased the open.',
            howToApproach: 'Wait for the reclaim of the overnight low.',
            watchOutFor: ['Chasing the first candle'],
            planGaps: ['No stay-out condition written'],
            motivation: 'One clean trade is enough.',
          },
        },
        [`${date}:postclose`]: {
          checkpoint: 'postclose',
          date,
          generatedAt,
          fingerprint,
          data: {
            headline,
            whatHappened: 'One trade, and one rule broken.',
            wentWell: ['Waited for the reclaim'],
            wentWrong: ['Moved the stop'],
            rulesBroken: ['Followed predetermined stops'],
            tomorrowAction: 'Set the stop once and leave it.',
            motivation: 'The process was mostly clean.',
          },
        },
      };

      localStorage.setItem(key, JSON.stringify({ version: 1, notes }));
    },
    { key: CHECKPOINT_CACHE_KEY, headline: SEEDED_HEADLINE }
  );

  // The card reads its note on mount, so writing to the cache afterwards is invisible
  // until it re-reads. Switching checkpoint is exactly that re-read, and it also keeps
  // these specs independent of any script-ordering assumptions.
  await page.locator('#coach-checkpoint-switch').click();
}

test.describe('Coach checkpoint written note', () => {
  test('is shown, folded away and opened again', async ({ page }) => {
    const card = page.locator('#coach-checkpoint-card');
    const result = card.locator('#coach-checkpoint-result');
    const toggle = card.locator('#coach-checkpoint-result-toggle');
    const body = card.locator('#coach-checkpoint-result-body');

    await seedCachedNotes(page);

    await expect(result).toHaveCount(1);
    await expect(body.getByText(SEEDED_HEADLINE)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await body.boundingBox())?.height ?? 0).toBeGreaterThan(0);

    await toggle.click();

    // aria-expanded is the state a screen reader reads, and the collapsed body has no
    // height at all — the text is still in the DOM but unreachable.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toHaveCSS('height', '0px');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body.getByText(SEEDED_HEADLINE)).toBeVisible();
    await expect.poll(async () => (await body.boundingBox())?.height ?? 0).toBeGreaterThan(0);
  });

  test('offers to regenerate the note it is showing', async ({ page }) => {
    await seedCachedNotes(page);

    // A written note turns the action into a regeneration, which is the only honest
    // label once there is something on screen to replace.
    await expect(page.locator('#coach-checkpoint-generate')).toHaveText(/Regenerate/i);
  });
});
