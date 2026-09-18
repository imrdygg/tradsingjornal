import { defineConfig } from 'vitest/config';

/**
 * Unit-test config (calculation tests only). Kept separate from
 * vite.config.ts so the Playwright e2e specs in e2e/ are never picked up by
 * `npm test` — those run via `npm run e2e`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Only unit tests under `src/` are scanned. Nothing may live in `api/` except the
    // generated serverless bundle — a test file there would be deployed as a function,
    // because the host turns every file in that directory into one.
    include: ['src/**/__tests__/*.{test,spec}.{ts,tsx}'],
  },
});
