import { defineConfig, devices } from '@playwright/test';

/** Browser e2e: the API (sandbox auth, demo seed) listens on :3000 and the production web build on :3001. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
