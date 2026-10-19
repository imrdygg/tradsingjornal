import { defineConfig, devices } from '@playwright/test';

/**
 * E2E for the standalone Chart Pattern Playbook.
 *
 * It runs against the **built** product (`dist/chart-patterns`), not the journal's dev
 * server: the point of this suite is to prove the artifact a buyer receives works on its
 * own — license gate, study persistence, deep links, export and import.
 *
 * `npm run e2e:product` builds first, then starts `vite preview` for the product config.
 */
export default defineConfig({
  testDir: './e2e-product',
  testMatch: /chart-patterns-product\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run preview:chart-patterns',
    url: 'http://localhost:4174/chart-patterns.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
