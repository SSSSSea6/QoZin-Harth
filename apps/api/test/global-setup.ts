import { startFreshDatabase, stopFreshDatabase, TEST_DB } from './test-db'

export default async function setup(): Promise<() => Promise<void>> {
  await startFreshDatabase(TEST_DB)
  return () => stopFreshDatabase(TEST_DB)
}
