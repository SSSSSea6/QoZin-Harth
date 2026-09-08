import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'
import { app } from './app'
import { pool } from './db'
import { migrateDatabase } from './db/migrate'
import { seed } from './db/seed'
import { cleanupSmsSends } from './domain/phone'
import { env } from './env'
import { runSweep } from './jobs/sweep'
import { chargeHolding } from './tools/fuel'
import { startRunLoop } from './tools/runs'
import { tickSchedules } from './tools/schedules'

export type { AppType } from './app'

const SWEEP_QUEUE = 'lifecycle-sweep'
const TOOL_TICK_QUEUE = 'tool-schedule-tick'
const FUEL_HOLDING_QUEUE = 'fuel-holding'

async function startJobs(): Promise<PgBoss | null> {
  if (!env.JOBS) return null
  const boss = new PgBoss(env.DATABASE_URL)
  boss.on('error', (error: unknown) => console.error('[pg-boss]', error))
  await boss.start()
  await boss.createQueue(SWEEP_QUEUE)
  await boss.work(SWEEP_QUEUE, async () => {
    const now = new Date()
    const result = await runSweep(now)
    if (result.hibernated || result.archived || result.woken) {
      console.log('[lifecycle]', result)
    }
    await cleanupSmsSends(now)
  })
  await boss.schedule(SWEEP_QUEUE, '13 * * * *', {}, { tz: 'Asia/Shanghai' })
  if (env.TOOL_RUNS) {
    await boss.createQueue(TOOL_TICK_QUEUE)
    await boss.work(TOOL_TICK_QUEUE, async () => {
      const result = await tickSchedules(new Date())
      if (result.created || result.skipped) console.log('[tools] 定时', result)
    })
    await boss.schedule(TOOL_TICK_QUEUE, '* * * * *', {}, { tz: 'Asia/Shanghai' })
    await boss.createQueue(FUEL_HOLDING_QUEUE)
    await boss.work(FUEL_HOLDING_QUEUE, async () => {
      const result = await chargeHolding(new Date())
      if (result.owners) console.log('[tools] 存储持有费', result)
    })
    await boss.schedule(FUEL_HOLDING_QUEUE, '7 0 * * *', {}, { tz: 'Asia/Shanghai' })
  }
  return boss
}

await migrateDatabase(env.DATABASE_URL)
await seed()
if (env.TOOL_RUNS) await startRunLoop()
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
