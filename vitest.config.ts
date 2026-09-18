import { defineConfig } from 'vitest/config';

/**
 * Unit-test config (calculation tests only). Kept separate from
 * vite.config.ts so the Playwright e2e specs in e2e/ are never picked up by
 * `npm test` — those run via `npm run e2e`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Only `src/` is scanned. Nothing may live in `api/` except serverless functions —
    // a test file there would be deployed as a function, because the host turns every
    // file in that directory into one.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
