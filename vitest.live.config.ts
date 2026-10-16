import { defineConfig } from 'vitest/config';

/**
 * The live cloud-contract run: `npm run test:live`.
 *
 * Separate from `vitest.config.ts` for two reasons, and both of them are about not lying:
 *
 *   1. **It runs one file.** That file is skipped by `npm test` on any machine without a project,
 *      which is right for a unit-test run but useless as an answer to "are my policies actually
 *      enforced?" — the point of asking is to get an answer, not a row of grey checks.
 *   2. **It makes the absence of a project a FAILURE rather than a skip.** `MEMORY_LIVE_INTENT` is
 *      set here and nowhere else, so this file alone can tell "nobody asked" (skip, in `npm test`)
 *      apart from "somebody asked and nothing was set up" (fail, with the variables to set). A
 *      skipped suite that looks green is exactly the kind of empty pass this repository's tests
 *      exist to avoid.
 *
 * It sets no credentials and no URL: those come from the shell, so the target project is always
 * something the caller named on purpose. Environment variables are exported rather than written into
 * this file so that no project's key is ever committed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/memory/__tests__/cloud-contract.live.test.ts'],
    env: { MEMORY_LIVE_INTENT: '1' },
    // The expiry check sleeps for five seconds on purpose, and that is one test rather than a slow
    // suite; the default per-test budget is left alone and the test names its own.
    testTimeout: 30_000,
  },
});
