import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { listDevices, registerDevice, removeDevice } from '../domain/devices'
import { listNotifications, markRead, unreadCount } from '../domain/notify'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

export const notificationsApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/', zValidator('query', z.object({ before: z.string().optional() })), async (c) => {
    return c.json({ notifications: await listNotifications(c.get('user')!.id, c.req.valid('query').before) })
  })

  .get('/unread-count', async (c) => c.json({ count: await unreadCount(c.get('user')!.id) }))

  .post(
    '/read',
    zValidator('json', z.object({ ids: z.array(z.string()).max(100).optional(), all: z.boolean().optional(), seenUpdatedAt: z.iso.datetime().optional() })),
    async (c) => {
      const input = c.req.valid('json')
      const updated = await markRead(c.get('user')!.id, {
        ids: input.ids,
        all: input.all,
        seenUpdatedAt: input.seenUpdatedAt ? new Date(input.seenUpdatedAt) : undefined,
      })
      return c.json({ updated })
    },
  )

export const devicesApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/', async (c) => c.json({ devices: await listDevices(c.get('user')!.id) }))

  .put(
    '/',
    zValidator(
      'json',
      z.object({
        platform: z.enum(['ios', 'android']),
        provider: z.enum(['apns', 'emas']),
        token: z.string().min(8).max(512),
        apnsEnv: z.enum(['sandbox', 'production']).optional(),
        appVersion: z.string().max(32).optional(),
      }),
    ),
    async (c) => {
      const registered = await registerDevice(c.get('user')!.id, c.get('session')!.id, c.req.valid('json'))
      return c.json(registered)
    },
  )

  .delete('/:id', zValidator('query', z.object({ bindingVersion: z.coerce.number().int().optional() })), async (c) => {
    const removed = await removeDevice(c.get('user')!.id, c.req.param('id'), c.req.valid('query').bindingVersion)
    return c.json({ removed })
  })
