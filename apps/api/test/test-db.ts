// 测试库：默认起内嵌 Postgres；设置了 HARTH_TEST_DATABASE_URL 就用那个库（须为空库），只跑迁移
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { migrateDatabase } from '../src/db/migrate'
import {
  ensureDatabase,
  HARTH_DIR,
  initCluster,
  prepareBinaries,
  startCluster,
  stopCluster,
} from '../scripts/embedded-pg'

export interface EmbeddedDb {
  port: number
  name: string
  dataDir: string
  logFile: string
}

function embedded(tag: string, port: number): EmbeddedDb {
  return {
    port,
    name: `harth_${tag}`,
    dataDir: join(HARTH_DIR, `pgdata-${tag}`),
    logFile: join(HARTH_DIR, `pg-${tag}.log`),
  }
}

export const TEST_DB = embedded('test', 5433)
export const E2E_DB = embedded('e2e', 5434)

export const USE_EXTERNAL_DB = Boolean(process.env.HARTH_TEST_DATABASE_URL)

export function databaseUrl(db: EmbeddedDb): string {
  return (
    process.env.HARTH_TEST_DATABASE_URL ??
    `postgres://harth:harth_dev@localhost:${db.port}/${db.name}`
  )
}

export async function startFreshDatabase(db: EmbeddedDb): Promise<string> {
  const url = databaseUrl(db)
  if (!USE_EXTERNAL_DB) {
    await prepareBinaries()
    if (existsSync(db.dataDir)) {
      await stopFreshDatabase(db)
      await rm(db.dataDir, { recursive: true, force: true })
    }
    await initCluster(db.dataDir)
    startCluster(db.dataDir, db.port, db.logFile)
    await ensureDatabase(db.port, db.name)
  }
  await migrateDatabase(url)
  return url
}

export async function stopFreshDatabase(db: EmbeddedDb): Promise<void> {
  if (USE_EXTERNAL_DB) return
  if (!existsSync(join(db.dataDir, 'postmaster.pid'))) return
  await prepareBinaries()
  stopCluster(db.dataDir)
}
