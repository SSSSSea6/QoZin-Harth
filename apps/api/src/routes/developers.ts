import { APPLICATION_NOTE_MAX, applicationMessageSchema, INVITE_BATCH_MAX, inviteCodeSchema } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  adminInvites,
  applyForDeveloper,
  createInvites,
  decideApplication,
  developerOf,
  latestApplication,
  listApplications,
  listDevelopers,
  myInvites,
  redeemInvite,
  restoreDeveloper,
  revokeDeveloper,
  statusOf,
} from '../domain/developers'
import { db } from '../db'
import { isAdmin } from '../env'
import { requireAuth } from '../middleware/session'
import { usageSummary } from '../tools/fuel'
import { applyLimiter, redeemLimiter } from '../tools/limits'
import type { AppEnv } from '../types'

function requireAdmin(user: { id: string }): void {
  if (!isAdmin(user)) throw new HTTPException(403, { message: '只有管理员能做这个' })
}

export const developersApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/me', async (c) => {
    const me = c.get('user')!
    const [row, application, usage] = await Promise.all([
      developerOf(db, me.id),
      latestApplication(me.id),
      usageSummary(me.id),
    ])
    const status = statusOf(row)
    const invites = status === 'active' ? await myInvites(me.id) : []
    return c.json({
      status,
      developer: row
        ? { grantedAt: row.grantedAt, source: row.source, revokedAt: row.revokedAt, revokeReason: row.revokeReason }
        : null,
      application: application
        ? {
            id: application.id,
            status: application.status,
            message: application.message,
            note: application.note,
            createdAt: application.createdAt,
            decidedAt: application.decidedAt,
          }
        : null,
      invites,
      usage: {
        month: usage.month,
        used: usage.used,
        reserved: usage.reserved,
        allowance: usage.allowance,
        storageBytes: usage.storageBytes,
      },
    })
  })

  .post('/redeem', zValidator('json', z.object({ code: inviteCodeSchema })), async (c) => {
    const me = c.get('user')!
    if (!redeemLimiter.take(`redeem:${me.id}`)) throw new HTTPException(429, { message: '试得太频繁了，一小时后再试' })
    const { codes } = await redeemInvite(me.id, c.req.valid('json').code)
    return c.json({ codes }, 201)
  })

  .post('/apply', zValidator('json', z.object({ message: applicationMessageSchema })), async (c) => {
    const me = c.get('user')!
    if (!applyLimiter.take(`apply:${me.id}`)) throw new HTTPException(429, { message: '今天申请得太多了，明天再试' })
    const application = await applyForDeveloper(me.id, c.req.valid('json').message)
    return c.json({ application: { id: application.id, status: application.status } }, 201)
  })

  .get('/applications', zValidator('query', z.object({ status: z.enum(['pending', 'decided']).default('pending') })), async (c) => {
    requireAdmin(c.get('user')!)
    return c.json({ applications: await listApplications(c.req.valid('query').status) })
  })

  .post(
    '/applications/:id/decide',
    zValidator(
      'json',
      z.object({
        decision: z.enum(['approve', 'reject']),
        note: z.string().trim().max(APPLICATION_NOTE_MAX).optional(),
      }),
    ),
    async (c) => {
      const me = c.get('user')!
      requireAdmin(me)
      const { decision, note } = c.req.valid('json')
      const result = await decideApplication(me.id, c.req.param('id'), decision, note)
      return c.json({ application: { id: result.application.id, status: result.application.status }, codes: result.codes })
    },
  )

  .get('/invites', async (c) => {
    requireAdmin(c.get('user')!)
    return c.json(await adminInvites())
  })

  .post('/invites', zValidator('json', z.object({ count: z.number().int().min(1).max(INVITE_BATCH_MAX) })), async (c) => {
    const me = c.get('user')!
    requireAdmin(me)
    const codes = await createInvites(db, { ownerId: null, createdBy: me.id, count: c.req.valid('json').count })
    return c.json({ codes }, 201)
  })

  .get('/list', async (c) => {
    requireAdmin(c.get('user')!)
    return c.json({ developers: await listDevelopers() })
  })

  .post('/:userId/revoke', zValidator('json', z.object({ reason: z.string().trim().min(1).max(300) })), async (c) => {
    const me = c.get('user')!
    requireAdmin(me)
    await revokeDeveloper(me.id, c.req.param('userId'), c.req.valid('json').reason)
    return c.json({ ok: true })
  })

  .post('/:userId/restore', async (c) => {
    requireAdmin(c.get('user')!)
    await restoreDeveloper(c.req.param('userId'))
    return c.json({ ok: true })
  })
