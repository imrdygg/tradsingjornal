import { defineConfig, devices } from '@playwright/test';

/**
 * E2E for the standalone MES Indicator Level Tracker.
 *
 * Runs against the **built** product (`dist/mes-tracker`), proving the artifact a buyer
 * receives works on its own: activation, logging a level, persistence, export, and restoring
 * a journal backup.
 */
export default defineConfig({
  testDir: './e2e-product',
  testMatch: /mes-tracker-product\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4175',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run preview:mes',
    url: 'http://localhost:4175/mes-tracker.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
