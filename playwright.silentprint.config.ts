import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone config for the silent-print MECHANISM test only. No globalSetup
 * and no storageState — the deterministic iframe/kiosk-print check needs only a
 * public same-origin document (/signin) under the app's real response headers,
 * so it must not depend on the dev sign-in flow. The full-app wiring test runs
 * under the normal playwright.config.ts (which provides auth).
 */
const BASE_URL = process.env.PW_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /receiving-silent-print\.spec\.ts/,
  grep: /hidden-iframe/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: BASE_URL },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
