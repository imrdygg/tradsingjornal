import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. The dev server is started with Supabase env vars stripped so the
 * app boots in local-only mode (no auth screen) and the tests exercise the
 * journal UI directly against the default seed data in localStorage.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3170',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port=3170 --strictPort',
    url: 'http://localhost:3170',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      DISABLE_HMR: 'true',
    },
  },
});
