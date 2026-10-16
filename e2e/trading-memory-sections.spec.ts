import { test, expect, type Page } from '@playwright/test';

/**
 * The four sections added after the library: indexing, similarity search, research, and retrieval
 * quality.
 *
 * These run against a local-only build, and that is the case worth pinning down rather than working
 * around. With no Supabase project there is no private bucket and no vector index, so every one of
 * these screens is looking at something it cannot do. The failure this spec exists to catch is a
 * screen that answers anyway: a search that renders "nothing similar found" when it never searched,
 * an indexing panel that reports success over an empty library, or a research screen that shows a
 * rate it cannot compute. Each assertion below is about which of those the trader is told, so a
 * section that quietly invented an answer would fail here.
 */

/** Both a desktop tab and a mobile tab exist in the DOM; only one is ever visible. */
function memoryTab(page: Page) {
  return page.locator('#nav-btn-memory, #mobile-nav-memory').filter({ visible: true }).first();
}

async function openMemory(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('ptj_observations_v1');
    localStorage.removeItem('ptj_memory_ai_v1');
  });
  await page.reload();
  await memoryTab(page).click();
  await expect(page.locator('#observation-library')).toBeVisible();
}

async function openSection(page: Page, section: string) {
  await page.locator(`#memory-section-${section}`).click();
}

test.describe('Trading Memory sections', () => {
  test('switches between the sections and back to the library', async ({ page }) => {
    await openMemory(page);

    const roots: Record<string, string> = {
      indexing: '#memory-indexing',
      search: '#memory-search',
      research: '#memory-research',
      evaluation: '#memory-evaluation',
    };

    for (const [section, root] of Object.entries(roots)) {
      await openSection(page, section);
      await expect(page.locator(root)).toBeVisible();
      // Only one section at a time, so a screen is never read under another one's headings.
      await expect(page.locator('#observation-library')).toHaveCount(0);
    }

    await openSection(page, 'library');
    await expect(page.locator('#observation-library')).toBeVisible();
    await expect(page.locator('#memory-search')).toHaveCount(0);
  });

  test('will not index anything until consent is given, and says what it is waiting on', async ({
    page,
  }) => {
    await openMemory(page);
    await openSection(page, 'indexing');

    // The switch lives in the library, and it starts off.
    await expect(page.locator('#memory-index-run')).toBeDisabled();
    await expect(page.locator('#memory-indexing')).toContainText('Waiting on consent');
    // And it names what this engine does not read. Without that, a journal full of screenshots
    // beside an empty library looks the same as a broken feature — which is how it was read.
    await expect(page.locator('#memory-indexing-scope')).toContainText('Sightings only');
  });

  test('with consent given, indexing names the missing cloud rather than running against nothing', async ({
    page,
  }) => {
    await openMemory(page);
    await page.locator('#memory-consent-toggle').check();
    await openSection(page, 'indexing');

    // The refusal is a response to the attempt, not a banner on the screen: pressing the button is
    // what makes the library explain itself. Answering the press with "indexed 0 pictures" would be
    // the dishonest outcome here, so the run must not report a result at all.
    await expect(page.locator('#memory-index-run')).toBeEnabled();
    await page.locator('#memory-index-run').click();
    await expect(page.locator('#memory-indexing-refusal')).toBeVisible();
    await expect(page.locator('#memory-index-summary')).toHaveCount(0);
  });

  test('the search refuses to send the query chart without consent, and does not call that "no matches"', async ({
    page,
  }) => {
    await openMemory(page);
    await openSection(page, 'search');

    await expect(page.locator('#memory-search-consent-block')).toBeVisible();
    // The distinction that matters: a refusal is not a result. Nothing may claim the library was
    // searched and came back empty.
    await expect(page.locator('#memory-results-empty')).toHaveCount(0);
    await expect(page.locator('#memory-search-run')).toBeDisabled();
  });

  test('with consent given but no project, the search says so instead of returning nothing', async ({
    page,
  }) => {
    await openMemory(page);
    await page.locator('#memory-consent-toggle').check();
    await openSection(page, 'search');

    await expect(page.locator('#memory-search-cloud-block')).toBeVisible();
    await expect(page.locator('#memory-results-empty')).toHaveCount(0);
  });

  test('research reports an empty record as empty, and offers no rate to read', async ({ page }) => {
    await openMemory(page);
    await openSection(page, 'research');

    await expect(page.locator('#memory-research-empty')).toBeVisible();
    await expect(page.locator('#memory-research-setups')).toHaveCount(0);
  });

  test('retrieval quality never presents a figure it has no evidence for', async ({ page }) => {
    await openMemory(page);
    await openSection(page, 'evaluation');

    // Either it has nothing to measure, or (with no project to read saved searches from) it says
    // why it cannot. What it must never do is show a score over zero cases.
    const noEvidence = page.locator('#memory-evaluation-empty-none, #memory-evaluation-error');
    await expect(noEvidence.first()).toBeVisible();
    await expect(page.locator('#memory-eval-figures')).toHaveCount(0);
  });

  test('a chart that looks like nothing can be kept, with no outcome and no vector yet', async ({
    page,
  }) => {
    await openMemory(page);
    await openSection(page, 'search');

    // Nothing is offered before a chart is picked: there is no sighting to record yet.
    await expect(page.locator('#memory-search-record')).toHaveCount(0);

    await page.locator('#memory-search-input').setInputFiles({
      name: 'chart.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
    });

    // Offered even though this build has no project and cannot search at all: keeping the chart is
    // the trader's own file, not a model call.
    await expect(page.locator('#memory-search-record')).toBeVisible();
    await page.locator('#memory-record-query').click();
    await expect(page.locator('#memory-search-notice')).toContainText('no outcome and no vector yet');

    // And it is a real record, not a notice: the library stops being empty.
    await openSection(page, 'library');
    await expect(page.locator('#observation-empty')).toHaveCount(0);
  });
});
