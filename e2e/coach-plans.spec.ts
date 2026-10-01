import { expect, test, type Page } from '@playwright/test';

/**
 * The Analytics read of the coach's own plans and the trader's grades.
 *
 * The grade is the only judgement the coach's planning ever gets, so this panel is its
 * scoreboard: the plans it made, which ones were graded, how the grades fall, and the exact
 * words the trader wrote. These tests seed plans straight into the journal and check that
 * record is shown as written — including a plan nobody has graded yet.
 */

const COACH_PLANS_KEY = 'ptj_coach_plans_v1';

interface SeededPlan {
  id: string;
  createdAt: string;
  direction: 'long' | 'short';
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  feedback?: string;
  headline?: string;
}

const PLANS: SeededPlan[] = [
  {
    id: 'cp-a',
    createdAt: '2026-09-21T13:00:00.000Z',
    direction: 'short',
    grade: 'A',
    headline: 'Short the failed push above the prior high',
    feedback: 'That is exactly how I wanted it framed — clear invalidation.',
  },
  {
    id: 'cp-f',
    createdAt: '2026-09-19T13:00:00.000Z',
    direction: 'long',
    grade: 'F',
    headline: 'Long into the range high',
    feedback: 'You chased the top of the range without any room to the target.',
  },
  { id: 'cp-new', createdAt: '2026-09-22T13:00:00.000Z', direction: 'long' },
];

async function seedPlans(page: Page, plans: SeededPlan[]) {
  await page.addInitScript(
    ({ plans, key }) => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('ptj_')) localStorage.removeItem(k);
      }
      localStorage.setItem(
        key,
        JSON.stringify(
          plans.map((plan, index) => ({
            id: plan.id,
            userId: 'u1',
            headline: plan.headline ?? '',
            createdAt: plan.createdAt,
            symbol: 'MES',
            marketPrice: 7740,
            direction: plan.direction,
            entry: 7742,
            stop: 7732,
            target: 7760,
            confidence: 'medium',
            entryReason: 'Waiting for a hold above the prior close.',
            exitReason: 'Target or the stop.',
            invalidation: 'A break back below the overnight low.',
            rationale: 'My own read, and it can be wrong.',
            grade: plan.grade,
            feedback: plan.feedback,
            gradedAt: plan.grade ? plan.createdAt : undefined,
            index,
          }))
        )
      );
    },
    { plans, key: COACH_PLANS_KEY }
  );
}

async function gotoAnalytics(page: Page) {
  const desktop = page.locator('#nav-btn-analytics');
  const mobile = page.locator('#mobile-nav-analytics');
  if (await desktop.isVisible()) {
    await desktop.click();
  } else {
    await mobile.click();
  }
  await expect(page.getByRole('heading', { name: /Analytics/i, level: 1 })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows the coach plans, the grades and the exact feedback', async ({ page }) => {
  await seedPlans(page, PLANS);
  await page.reload();
  await gotoAnalytics(page);

  const panel = page.locator('#coach-plan-grades');
  await expect(panel).toBeVisible();

  // The counts: three plans made, two graded, one still waiting for a judgement.
  const facts = panel.locator('#coach-plan-grades-facts');
  await expect(facts).toContainText('Plans made');
  await expect(facts).toContainText('3');
  await expect(facts).toContainText('1 still ungraded');
  await expect(facts).toContainText('With a note');
  await expect(facts).toContainText('2');

  // Every plan is listed, newest first, with its grade and the trader's own words.
  const rows = panel.locator('[data-coach-plan-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('2026-09-22');
  await expect(rows.first()).toContainText('ungraded');

  const gradedRow = panel.locator('[data-coach-plan-row="cp-a"]');
  await expect(gradedRow).toContainText('A');
  await expect(gradedRow).toContainText('short');
  await expect(gradedRow).toContainText(
    'That is exactly how I wanted it framed — clear invalidation.'
  );

  const failedRow = panel.locator('[data-coach-plan-row="cp-f"]');
  await expect(failedRow).toContainText('F');
  await expect(failedRow).toContainText('You chased the top of the range');

  // Two graded plans is a trend: the line is drawn, on an A–F axis.
  const trend = panel.locator('#coach-plan-grade-trend');
  await expect(trend).toBeVisible();
  await expect(trend).toContainText('Grade over time');
  await expect(trend.locator('svg')).toHaveCount(1);
  await expect(trend).toContainText('Ungraded plans are not plotted');
});

test('waits for a second grade before drawing a trend line', async ({ page }) => {
  await seedPlans(page, [
    { id: 'only', createdAt: '2026-09-21T13:00:00.000Z', direction: 'long', grade: 'B' },
  ]);
  await page.reload();
  await gotoAnalytics(page);

  // A single graded plan is a point, not a trend, so the chart stays out of the way.
  await expect(page.locator('#coach-plan-grades')).toBeVisible();
  await expect(page.locator('#coach-plan-grade-trend')).toHaveCount(0);
});

test('says plainly when the coach has not made a plan yet', async ({ page }) => {
  await seedPlans(page, []);
  await page.reload();
  await gotoAnalytics(page);

  const panel = page.locator('#coach-plan-grades');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/has not made a plan of its own yet/i);
  await expect(panel.locator('[data-coach-plan-row]')).toHaveCount(0);
});
