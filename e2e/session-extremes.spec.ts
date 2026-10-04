import { expect, test } from '@playwright/test';

/** The manual extreme log is the source of the intraday chart and its review ratings. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('session-extremes-spec-initialized')) return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ptj_')) localStorage.removeItem(key);
    }
    sessionStorage.setItem('session-extremes-spec-initialized', '1');
  });
  await page.goto('/');
});

test('plots all three symbols separately and keeps price edits and ratings', async ({ page }) => {
  const card = page.locator('#session-extremes');
  await card.scrollIntoViewIfNeeded();
  const date = await page.locator('#extreme-date').inputValue();

  const addExtreme = async (symbol: string, kind: 'high' | 'low', time: string, price: string) => {
    await page.locator('#extreme-date').fill(date);
    await page.locator('#extreme-instrument').selectOption({ label: symbol });
    await page.locator(`#extreme-kind-${kind}`).click();
    await page.locator('#extreme-time').fill(time);
    await page.locator('#extreme-price').fill(price);
    await page.locator('#extreme-save').click();
  };

  await addExtreme('MES', 'high', '08:05', '6012.25');
  await addExtreme('MNQ', 'low', '08:15', '21950');
  await addExtreme('MCL', 'high', '08:25', '70.25');

  const charts = page.locator('#extremes-price-pattern');
  await expect(charts.locator('[data-extreme-price-chart="MES"]')).toHaveAttribute('data-extreme-chart-count', '1');
  await expect(charts.locator('[data-extreme-price-chart="MNQ"]')).toHaveAttribute('data-extreme-chart-count', '1');
  await expect(charts.locator('[data-extreme-price-chart="MCL"]')).toHaveAttribute('data-extreme-chart-count', '1');
  await expect(charts).toContainText('Separate price scales for MES, MNQ and MCL');

  const mesRow = card.locator('[data-extreme-row]').filter({ hasText: '08:05' });
  const mesId = await mesRow.getAttribute('data-extreme-row');
  await mesRow.getByRole('button', { name: 'Edit the 08:05 high' }).click();
  const editForm = card.locator(`[data-extreme-editing="${mesId}"]`);
  await editForm.locator('input[aria-label="Price"]').fill('6013.25');
  await editForm.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(mesRow).toContainText('6013.25');
  await expect(charts.locator('[data-extreme-price-chart="MES"]')).toHaveAttribute('data-extreme-chart-count', '1');

  await mesRow.getByRole('button', { name: 'Rate it' }).click();
  const rating = mesRow.locator('[data-extreme-rating="30m"]');
  await rating.getByRole('button', { name: 'Held' }).click();
  await expect(rating.getByRole('button', { name: 'Held' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  const restored = page.locator('#session-extremes').locator('[data-extreme-row]').filter({ hasText: '08:05' });
  await expect(restored).toContainText('6013.25');
  await expect(restored.getByRole('button', { name: /Rated/ })).toBeVisible();
  await expect(page.locator('#extremes-price-pattern [data-extreme-price-chart="MES"]')).toHaveAttribute('data-extreme-chart-count', '1');
  await expect(page.locator('#extremes-price-pattern [data-extreme-price-chart="MNQ"]')).toHaveAttribute('data-extreme-chart-count', '1');
  await expect(page.locator('#extremes-price-pattern [data-extreme-price-chart="MCL"]')).toHaveAttribute('data-extreme-chart-count', '1');
});

/**
 * A print is often written down after the session it was read from — Friday's close logged on
 * Saturday — so its date has to be editable, not only the time and price.
 */
test('re-dates a logged extreme to the session it belongs to, and it survives a reload', async ({
  page,
}) => {
  const card = page.locator('#session-extremes');
  await card.scrollIntoViewIfNeeded();

  await page.locator('#extreme-instrument').selectOption({ label: 'MES' });
  await page.locator('#extreme-kind-high').click();
  await page.locator('#extreme-time').fill('08:05');
  await page.locator('#extreme-price').fill('6012.25');
  await page.locator('#extreme-save').click();

  const row = card.locator('[data-extreme-row]').filter({ hasText: '08:05' });
  const id = await row.getAttribute('data-extreme-row');
  await row.getByRole('button', { name: 'Edit the 08:05 high' }).click();

  const editForm = card.locator(`[data-extreme-editing="${id}"]`);
  await editForm.locator('input[aria-label="Session date"]').fill('2026-09-24');
  await editForm.getByRole('button', { name: 'Save', exact: true }).click();

  // The print now reads under the earlier session in the log.
  await expect(page.locator('#extremes-log')).toContainText('Sep 24');

  await page.reload();
  const restored = page.locator('#session-extremes').locator('[data-extreme-row]').filter({ hasText: '08:05' });
  await expect(restored).toHaveCount(1);
  await expect(page.locator('#extremes-log')).toContainText('Sep 24');
});
