import { reportInputSchema } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { createReport, myReports } from '../domain/governance'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

export const reportsApp = new Hono<AppEnv>()
  .use(requireAuth)
  .post('/', zValidator('json', reportInputSchema), async (c) => {
    return c.json(await createReport(c.get('user')!.id, c.req.valid('json')), 201)
  })
  .get('/mine', async (c) => c.json({ reports: await myReports(c.get('user')!.id) }))
