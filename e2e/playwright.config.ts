import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3199);

/** Smoke test: `npm run e2e` (builds the web app, starts e2e/server.ts, runs the specs in Chromium). */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../test-results',
  timeout: 8 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node_modules/.bin/tsx e2e/server.ts',
    cwd: '..',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(port) },
  },
});
