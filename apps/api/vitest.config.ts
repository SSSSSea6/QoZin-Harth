import { defineConfig } from 'vitest/config'
import { databaseUrl, TEST_DB, TEST_TOOLS_DIR } from './test/test-db'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl(TEST_DB),
      BETTER_AUTH_SECRET: 'test-only-secret',
      BETTER_AUTH_URL: 'http://localhost:3001',
      WEB_URL: 'http://localhost:3000',
      HARTH_TEST_HOOKS: '1',
      HARTH_JOBS: '0',
      HARTH_ADMIN_EMAILS: 'admin@test.dev',
      HARTH_TOOLS_DIR: TEST_TOOLS_DIR,
    },
  },
})
