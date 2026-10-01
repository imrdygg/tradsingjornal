import { expect, test, type Page } from '@playwright/test';

/**
 * The Calls tab: the coach's own calls, kept as drafts and scored.
 *
 * This is where the coach's calls live now — make one, keep it, grade it and mark what it
 * actually did. These tests cover the parts a trader relies on: the scoreboard at the top
 * being arithmetic they can check, an earlier call opening when it is clicked (rather than
 * being unreadable text), a result being marked without leaving the tab, and a call being
 * deleted.
 *
 * The Playwright server is `vite dev`, which does not serve the `api/` function, so making a
 * new call cannot succeed here; that path is asserted as failing honestly.
 */

const COACH_PLANS_KEY = 'ptj_coach_plans_v1';

interface SeededCall {
  id: string;
  createdAt: string;
  symbol?: string;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  headline: string;
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  outcome?: 'target' | 'stopped' | 'no-fill' | 'open';
  feedback?: string;
}

/** Two winners and a loser, plus one still open — a scoreboard with something in every bucket. */
const CALLS: SeededCall[] = [
  {
    id: 'c-open',
    createdAt: '2026-09-24T13:00:00.000Z',
    direction: 'long',
    entry: 7740,
    stop: 7730,
    target: 7770,
    headline: 'Open call on the retest',
    outcome: 'open',
  },
  {
    id: 'c-win-b',
    createdAt: '2026-09-22T13:00:00.000Z',
    direction: 'short',
    entry: 7740,
    stop: 7750,
    target: 7720,
    headline: 'Short the failed push',
    grade: 'B',
    outcome: 'target',
    feedback: 'Right side, good invalidation.',
  },
  {
    id: 'c-loss',
    createdAt: '2026-09-20T13:00:00.000Z',
    direction: 'long',
    entry: 7740,
    stop: 7730,
    target: 7780,
    headline: 'Long into the range high',
    grade: 'C',
    outcome: 'stopped',
    feedback: 'Chased the top of the range.',
  },
  {
    id: 'c-win-a',
    createdAt: '2026-09-18T13:00:00.000Z',
    direction: 'short',
    entry: 7740,
    stop: 7730,
    target: 7770,
    headline: 'Sweep then reversal',
    grade: 'A',
    outcome: 'target',
    feedback: 'Exactly how I want the entry framed.',
  },
];

async function seedCalls(page: Page, calls: SeededCall[]) {
  await page.addInitScript(
    ({ calls, key }) => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('ptj_')) localStorage.removeItem(k);
      }
      localStorage.setItem(
        key,
        JSON.stringify(
          calls.map((call) => ({
            id: call.id,
            userId: 'u1',
            headline: call.headline,
            createdAt: call.createdAt,
            symbol: call.symbol ?? 'MES',
            marketPrice: 7740,
            direction: call.direction,
            entry: call.entry,
            stop: call.stop,
            target: call.target,
            confidence: 'medium',
            entryReason: 'Waiting for the hold.',
            exitReason: 'Target or the stop.',
            invalidation: 'A break back through the level.',
            rationale: 'My own read, and it can be wrong.',
            grade: call.grade,
            feedback: call.feedback,
            gradedAt: call.grade ? call.createdAt : undefined,
            outcome: call.outcome,
            outcomeAt: call.outcome ? call.createdAt : undefined,
          }))
        )
      );
    },
    { calls, key: COACH_PLANS_KEY }
  );
}

async function gotoCalls(page: Page) {
  const desktop = page.locator('#nav-btn-calls');
  const mobile = page.locator('#mobile-nav-calls');
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await expect(page.getByRole('heading', { name: /^Calls$/i, level: 1 })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('The Calls tab', () => {
  test('is reachable and explains itself before any call exists', async ({ page }) => {
    await gotoCalls(page);

    const overview = page.locator('#calls-overview');
    await expect(overview).toBeVisible();
    await expect(overview).toContainText(/No calls yet/i);

    // The make-a-call card is here, and nothing is gradeable before a call exists.
    await expect(page.locator('#coach-self-plan')).toBeVisible();
    await expect(page.locator('#coach-self-plan-generate')).toBeVisible();
    await expect(page.locator('#coach-plan-feedback')).toHaveCount(0);
    await expect(page.locator('#coach-plan-grade-A')).toHaveCount(0);
  });

  test('scores the calls: win rate, net R, average grade and the trend', async ({ page }) => {
    await seedCalls(page, CALLS);
    await page.reload();
    await gotoCalls(page);

    // 3 settled (2 wins, 1 loss) → 67% and +4.00R (3R win, 2R win, -1R loss);
    // 3 of 4 graded, A/C/B averaging 75%.
    const facts = page.locator('#calls-overview-facts');
    await expect(facts).toContainText('Calls made');
    await expect(facts).toContainText('67%');
    await expect(facts).toContainText('2W / 1L');
    await expect(facts).toContainText('+4.00R');
    await expect(facts).toContainText('3 of 4 graded');
    await expect(facts).toContainText('75%');

    // Three graded calls is a trend line.
    await expect(page.locator('#calls-grade-trend svg')).toHaveCount(1);

    // The outcome breakdown counts what the trader marked.
    await expect(page.locator('#calls-overview')).toContainText('Target hit');
    await expect(page.locator('#calls-overview')).toContainText('Stopped out');
    await expect(page.locator('#calls-overview')).toContainText('Still open');
    // Every call here has been marked, so nothing is waiting on a result.
    await expect(page.locator('#calls-overview')).toContainText(/0 not marked yet/i);

    // The result is the coach's own, and says so rather than reading as account P&L.
    await expect(page.locator('#calls-overview')).toContainText(/not your account P&L/i);
  });

  test('opens an earlier call when it is clicked, so it can be graded later', async ({ page }) => {
    await seedCalls(page, CALLS);
    await page.reload();
    await gotoCalls(page);

    // Four saved calls, all listed.
    await expect(page.locator('[data-coach-plan-row]')).toHaveCount(4);

    // Clicking an older call opens it: its headline (which only the open panel renders) and
    // its grade are on screen — clicking used to do nothing.
    await page.locator('[data-coach-plan-open="c-loss"]').click();
    await expect(page.locator('#coach-self-plan')).toContainText('Long into the range high');
    await expect(page.locator('#coach-plan-grade-C')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#coach-plan-feedback')).toHaveValue('Chased the top of the range.');
    // Its marked result is shown with it.
    await expect(page.locator('#coach-plan-outcome-stopped')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // And a different call can be swapped in without losing the first.
    await page.locator('[data-coach-plan-open="c-win-a"]').click();
    await expect(page.locator('#coach-self-plan')).toContainText('Sweep then reversal');
    await expect(page.locator('#coach-plan-grade-A')).toHaveAttribute('aria-pressed', 'true');
  });

  test('marks a result on a draft, and the scoreboard counts it', async ({ page }) => {
    await seedCalls(page, [
      {
        id: 'c-draft',
        createdAt: '2026-09-23T13:00:00.000Z',
        direction: 'long',
        entry: 7740,
        stop: 7730,
        target: 7760,
        headline: 'Waiting on the retest',
      },
    ]);
    await page.reload();
    await gotoCalls(page);

    // An unmarked call is a draft and carries no win rate.
    await expect(page.locator('[data-coach-plan-row="c-draft"]')).toContainText('draft');
    await expect(page.locator('#calls-overview-facts')).toContainText('no settled calls yet');

    await page.locator('#coach-plan-outcome-target').click();
    await page.locator('#coach-plan-grade-B').click();
    await page.locator('#coach-plan-save-grade').click();

    // The row shows the win and the draft is gone.
    const row = page.locator('[data-coach-plan-row="c-draft"]');
    await expect(row).toContainText('WIN');
    await expect(row).not.toContainText('draft');
    // A 2R target on a 10-point risk with a 20-point target, settled, so the rate moves.
    await expect(page.locator('#calls-overview-facts')).toContainText('100%');
    await expect(page.locator('#calls-overview-facts')).toContainText('1W / 0L');
  });

  test('deletes a call from the list', async ({ page }) => {
    await seedCalls(page, CALLS);
    await page.reload();
    await gotoCalls(page);

    await expect(page.locator('[data-coach-plan-row]')).toHaveCount(4);
    await page.locator('[data-coach-plan-delete="c-open"]').click();
    await expect(page.locator('[data-coach-plan-row]')).toHaveCount(3);
    await expect(page.locator('[data-coach-plan-row="c-open"]')).toHaveCount(0);
  });

  test('reports honestly when a call cannot be made, rather than inventing one', async ({
    page,
  }) => {
    await gotoCalls(page);

    await expect(page.locator('#coach-error-self-plan')).toHaveCount(0);
    await page.locator('#coach-self-plan-generate').click();

    const error = page.locator('#coach-error-self-plan');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Coach not available here/i);
    await expect(page.locator('#coach-plan-feedback')).toHaveCount(0);
  });
});

test.describe('History moved to the account menu', () => {
  test('is reachable from the avatar menu and no longer takes a tab', async ({ page }) => {
    await expect(page.locator('#nav-btn-history')).toHaveCount(0);
    await expect(page.locator('#mobile-nav-history')).toHaveCount(0);

    await page.locator('#account-menu-btn').click();
    await page.locator('#account-menu-history-btn').click();
    await expect(page.getByRole('heading', { name: /History/i, level: 1 })).toBeVisible();
  });
});
