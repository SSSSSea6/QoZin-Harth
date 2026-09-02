import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { auth } from '../auth'
import type { AppEnv } from '../types'

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('user', session?.user ?? null)
  c.set('session', session?.session ?? null)
  await next()
})

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) {
    throw new HTTPException(401, { message: '请先登录' })
  }
  await next()
})
