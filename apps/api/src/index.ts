import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'
import { app } from './app'
import { pool } from './db'
import { migrateDatabase } from './db/migrate'
import { seed } from './db/seed'
import { cleanupSmsSends } from './domain/phone'
import { env } from './env'
import { setBoss, NOTIFY_QUEUE } from './jobs/boss'
import { deliverNotification } from './jobs/deliver'
import { runSweep } from './jobs/sweep'
import { cleanupNotifications } from './domain/notify'
import { shutdownTransports } from './push/transports'
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
    await cleanupNotifications(now)
  })
  await boss.schedule(SWEEP_QUEUE, '13 * * * *', {}, { tz: 'Asia/Shanghai' })
  await boss.createQueue(NOTIFY_QUEUE, { retryLimit: 5, retryBackoff: true, retryDelay: 60, retryDelayMax: 900, expireInSeconds: 120 })
  await boss.work<{ notificationId: string }>(NOTIFY_QUEUE, async ([job]) => {
    if (job) await deliverNotification(job.data.notificationId)
  })
  setBoss(boss)
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
      // 先停止取新任务、放掉发送器，再关数据库
      void (async () => {
        await boss?.stop({ graceful: true, timeout: 30_000 }).catch(() => {})
        await shutdownTransports()
        await pool.end().catch(() => {})
        process.exit(0)
      })()
    })
  })
}
