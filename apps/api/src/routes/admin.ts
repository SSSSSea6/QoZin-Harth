import { decideReportSchema, MODERATION_REASON_MAX, REPORT_TARGET_TYPES } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { contentRules } from '../db/schema'
import { decideAppeal, decideReport, evidence, listAppeals, listModerations, listReports, moderateDirect, recentContent, reverseModeration } from '../domain/governance'
import { invalidateRules } from '../domain/rules'
import { isAdmin } from '../env'
import { fail } from '../http'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

const reason = z.string().trim().min(1).max(MODERATION_REASON_MAX)

export const adminApp = new Hono<AppEnv>()
  .use(requireAuth)
  .use(async (c, next) => {
    if (!isAdmin(c.get('user')!)) throw fail(403, 'FORBIDDEN', '只有管理员能做这个')
    await next()
  })

  .get('/reports', zValidator('query', z.object({ status: z.enum(['pending', 'handled', 'dismissed']).default('pending') })), async (c) => {
    return c.json({ reports: await listReports(c.req.valid('query').status) })
  })

  .get('/reports/:id/evidence', async (c) => c.json(await evidence(c.req.param('id'))))

  .post('/reports/:id/decide', zValidator('json', decideReportSchema), async (c) => {
    return c.json(await decideReport(c.get('user')!.id, c.req.param('id'), c.req.valid('json')))
  })

  .get('/moderations', async (c) => c.json({ moderations: await listModerations() }))

  .post(
    '/moderate',
    zValidator(
      'json',
      z.object({
        targetType: z.enum(REPORT_TARGET_TYPES),
        targetId: z.string().min(1),
        action: z.enum(['hide', 'mute', 'ban', 'tool_suspend']),
        reason,
        days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
      }),
    ),
    async (c) => c.json(await moderateDirect(c.get('user')!.id, c.req.valid('json'))),
  )

  .post('/moderations/:id/reverse', zValidator('json', z.object({ reason })), async (c) => {
    return c.json(await reverseModeration(c.get('user')!.id, c.req.param('id'), c.req.valid('json').reason))
  })

  .get('/appeals', zValidator('query', z.object({ status: z.enum(['pending', 'accepted', 'rejected']).default('pending') })), async (c) => {
    return c.json({ appeals: await listAppeals(c.req.valid('query').status) })
  })

  .post('/appeals/:id/decide', zValidator('json', z.object({ accept: z.boolean(), note: reason })), async (c) => {
    const { accept, note } = c.req.valid('json')
    await decideAppeal(c.get('user')!.id, c.req.param('id'), accept, note)
    return c.json({ ok: true })
  })

  .get('/content', async (c) => c.json(await recentContent()))

  .get('/rules', async (c) => c.json({ rules: await db.select().from(contentRules).orderBy(desc(contentRules.createdAt)) }))

  .post(
    '/rules',
    zValidator('json', z.object({ pattern: z.string().trim().min(1).max(100), kind: z.enum(['reject', 'flag']), note: z.string().trim().max(200).optional() })),
    async (c) => {
      const input = c.req.valid('json')
      const [row] = await db
        .insert(contentRules)
        .values({ pattern: input.pattern, kind: input.kind, note: input.note || null, createdBy: c.get('user')!.id })
        .returning()
      invalidateRules()
      return c.json({ rule: row }, 201)
    },
  )

  .delete('/rules/:id', async (c) => {
    await db.delete(contentRules).where(eq(contentRules.id, c.req.param('id')))
    invalidateRules()
    return c.json({ ok: true })
  })
