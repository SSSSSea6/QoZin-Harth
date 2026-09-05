import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { circles } from '../db/schema'
import { runSweep } from '../jobs/sweep'
import { makeSchedulesDue, tickSchedules } from '../tools/schedules'
import { getTool } from '../tools/service'

// 只在 HARTH_TEST_HOOKS=1 时挂载，测试里用来改写时间、触发巡查与定时任务
export const testHooksApp = new Hono()
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
