import { rm } from 'node:fs/promises'
import { startFreshDatabase, stopFreshDatabase, TEST_DB, TEST_TOOLS_DIR } from './test-db'

export default async function setup(): Promise<() => Promise<void>> {
  await rm(TEST_TOOLS_DIR, { recursive: true, force: true })
  await startFreshDatabase(TEST_DB)
  return () => stopFreshDatabase(TEST_DB)
}
