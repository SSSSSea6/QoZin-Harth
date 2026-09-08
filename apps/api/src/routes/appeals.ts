import { APPEAL_TEXT_MAX } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createAppeal, myModerations } from '../domain/governance'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

// 被处置的人看自己的处置记录、对其中一条提交申诉
export const appealsApp = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/mine', async (c) => c.json({ moderations: await myModerations(c.get('user')!.id) }))
  .post(
    '/',
    zValidator('json', z.object({ moderationId: z.string().min(1), text: z.string().trim().min(1).max(APPEAL_TEXT_MAX) })),
    async (c) => {
      const { moderationId, text } = c.req.valid('json')
      return c.json(await createAppeal(c.get('user')!.id, moderationId, text), 201)
    },
  )
