import { defineConfig, devices } from '@playwright/test'

// 独立端口：web 3100、api 3101、测试库 5434，可以和 pnpm dev 同时跑
export const WEB_URL = 'http://localhost:3100'
export const API_URL = 'http://localhost:3101'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalTeardown: './global-teardown',
  webServer: [
    {
      name: 'api',
      command: 'pnpm --filter api serve:e2e',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      env: {
        API_PORT: '3101',
        WEB_URL,
        BETTER_AUTH_URL: API_URL,
        BETTER_AUTH_SECRET: 'e2e-only-secret-never-use-in-production',
        HARTH_TEST_HOOKS: '1',
        HARTH_JOBS: '0',
        HARTH_ADMIN_EMAILS: 'admin@e2e.test',
      },
    },
    {
      name: 'web',
      command: 'pnpm --filter web build && pnpm --filter web start --port 3100',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { NEXT_PUBLIC_API_URL: API_URL, NEXT_DIST_DIR: '.next/e2e' },
    },
  ],
})
