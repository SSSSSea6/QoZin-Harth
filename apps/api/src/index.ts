import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'
import { app } from './app'
import { pool } from './db'
import { migrateDatabase } from './db/migrate'
import { seed } from './db/seed'
import { env } from './env'
import { runSweep } from './jobs/sweep'

export type { AppType } from './app'

const SWEEP_QUEUE = 'lifecycle-sweep'

async function startJobs(): Promise<PgBoss | null> {
  if (!env.JOBS) return null
  const boss = new PgBoss(env.DATABASE_URL)
  boss.on('error', (error: unknown) => console.error('[pg-boss]', error))
  await boss.start()
  await boss.createQueue(SWEEP_QUEUE)
  await boss.work(SWEEP_QUEUE, async () => {
    const result = await runSweep(new Date())
    if (result.hibernated || result.archived || result.woken) {
      console.log('[lifecycle]', result)
    }
  })
  await boss.schedule(SWEEP_QUEUE, '13 * * * *', {}, { tz: 'Asia/Shanghai' })
  return boss
}

await migrateDatabase(env.DATABASE_URL)
await seed()
const boss = await startJobs()

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void Promise.allSettled([boss?.stop(), pool.end()]).then(() =>
        process.exit(0),
      )
    })
  })
}
