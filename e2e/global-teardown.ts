import { E2E_DB, stopFreshDatabase } from '../apps/api/test/test-db'

// Windows 上 Playwright 强杀 api 进程，测试库要在这里停
export default async function teardown(): Promise<void> {
  await stopFreshDatabase(E2E_DB)
}
