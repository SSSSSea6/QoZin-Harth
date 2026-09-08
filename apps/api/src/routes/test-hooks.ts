import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { circles } from '../db/schema'
import { grantTestAdmin } from '../env'
import { deliverNotification } from '../jobs/deliver'
import { useTestTransport, type DeviceRow, type PushMessage } from '../push/transports'
import { lastTestCode } from '../sms'
import { runSweep } from '../jobs/sweep'
import { chargeHolding } from '../tools/fuel'
import { makeSchedulesDue, tickSchedules } from '../tools/schedules'
import { getTool } from '../tools/service'

const fakePhone = () => `+861${Math.floor(3_000_000_000 + Math.random() * 6_999_999_999)}`

// 测试发送器：记下每次外发，可切成"设备失效"或"暂时失败"
const sent: { deviceId: string; token: string; notificationId: string; kind: string; title: string }[] = []
let transportMode: 'record' | 'unregistered' | 'fail' | 'config-error' = 'record'

// 只在 HARTH_TEST_HOOKS=1 时挂载，测试里用来指定管理员、改写时间、触发巡查与定时任务
export const testHooksApp = new Hono()
  .post('/admin', zValidator('json', z.object({ userId: z.string() })), (c) => {
    grantTestAdmin(c.req.valid('json').userId)
    return c.json({ ok: true })
  })
  .post('/deliver', zValidator('json', z.object({ notificationId: z.string() })), async (c) => {
    try {
      return c.json(await deliverNotification(c.req.valid('json').notificationId))
    } catch (err) {
      return c.json({ retry: true, error: err instanceof Error ? err.message : String(err) }, 202)
    }
  })
  .post('/transport', zValidator('json', z.object({ mode: z.enum(['record', 'unregistered', 'fail', 'config-error', 'off']) })), (c) => {
    const { mode } = c.req.valid('json')
    sent.length = 0
    if (mode === 'off') {
      useTestTransport(null)
      return c.json({ ok: true })
    }
    transportMode = mode
    useTestTransport({
      async send(device: DeviceRow, message: PushMessage) {
        if (transportMode === 'fail') throw new Error('暂时失败')
        if (transportMode === 'config-error') {
          const { PushConfigError } = await import('../push/transports')
          throw new PushConfigError('密钥错误')
        }
        if (transportMode === 'unregistered') return 'unregistered'
        sent.push({ deviceId: device.id, token: device.token, notificationId: message.notificationId, kind: message.kind, title: message.title })
        return 'sent'
      },
      shutdown: async () => {},
    })
    return c.json({ ok: true })
  })
  .get('/transport', (c) => c.json({ sent }))
  .get('/sms', zValidator('query', z.object({ phone: z.string() })), (c) => {
    return c.json({ code: lastTestCode(c.req.valid('query').phone) })
  })
  .post(
    '/verify-phone',
    zValidator('json', z.object({ userId: z.string(), phone: z.string().optional() })),
    async (c) => {
      const { userId, phone } = c.req.valid('json')
      const value = phone ?? fakePhone()
      await db.update(user).set({ phoneNumber: value, phoneNumberVerified: true }).where(eq(user.id, userId))
      return c.json({ phone: value })
    },
  )
  .post(
    '/fuel-holding',
    zValidator('json', z.object({ now: z.iso.datetime().optional() })),
    async (c) => {
      const { now } = c.req.valid('json')
      return c.json(await chargeHolding(now ? new Date(now) : new Date()))
    },
  )
  .post(
    '/circle-times',
    zValidator(
      'json',
      z.object({
        circleId: z.string(),
        lastActivityAt: z.iso.datetime().optional(),
        hibernationDeadline: z.iso.datetime().nullable().optional(),
      }),
    ),
    async (c) => {
      const input = c.req.valid('json')
      const patch: Record<string, Date | null> = {}
      if (input.lastActivityAt !== undefined) {
        patch.lastActivityAt = new Date(input.lastActivityAt)
      }
      if (input.hibernationDeadline !== undefined) {
        patch.hibernationDeadline = input.hibernationDeadline
          ? new Date(input.hibernationDeadline)
          : null
      }
      await db.update(circles).set(patch).where(eq(circles.id, input.circleId))
      return c.json({ ok: true })
    },
  )
  .post(
    '/sweep',
    zValidator('json', z.object({ now: z.iso.datetime().optional() })),
    async (c) => {
      const { now } = c.req.valid('json')
      const result = await runSweep(now ? new Date(now) : new Date())
      return c.json(result)
    },
  )
  .post(
    '/tool-schedules-due',
    zValidator('json', z.object({ circleId: z.string(), slug: z.string() })),
    async (c) => {
      const { circleId, slug } = c.req.valid('json')
      const tool = await getTool(slug)
      return c.json({ schedules: tool ? await makeSchedulesDue(circleId, tool.id) : 0 })
    },
  )
  .post(
    '/tool-tick',
    zValidator('json', z.object({ now: z.iso.datetime().optional() })),
    async (c) => {
      const { now } = c.req.valid('json')
      return c.json(await tickSchedules(now ? new Date(now) : new Date()))
    },
  )
