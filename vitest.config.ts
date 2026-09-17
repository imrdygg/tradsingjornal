import { defineConfig } from 'vitest/config';

/**
 * Unit-test config (calculation tests only). Kept separate from
 * vite.config.ts so the Playwright e2e specs in e2e/ are never picked up by
 * `npm test` — those run via `npm run e2e`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
