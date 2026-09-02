// Playwright 用的 api 进程：起一套新的测试库并迁移，然后加载 api
import { E2E_DB, startFreshDatabase, stopFreshDatabase } from './test-db'

process.env.DATABASE_URL = await startFreshDatabase(E2E_DB)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void stopFreshDatabase(E2E_DB))
}

// env.ts 在这之后才读 DATABASE_URL
await import('../src/index')
