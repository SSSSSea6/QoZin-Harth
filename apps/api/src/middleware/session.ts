import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { auth } from '../auth'
import { db } from '../db'
import { assertActive } from '../domain/policy'
import type { AppEnv } from '../types'

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('user', session?.user ?? null)
  c.set('session', session?.session ?? null)
  await next()
})

// 被封禁的账号只剩下看自己、导出、注销、申诉、举报这几条路
const BANNED_ALLOWED = [
  /^\/api\/users\/me(\/export|\/delete)?$/,
  /^\/api\/appeals(\/|$)/,
  /^\/api\/reports$/,
]

export const enforceRestrictions = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (user && !BANNED_ALLOWED.some((re) => re.test(c.req.path))) {
    await assertActive(db, user.id)
  }
  await next()
})

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) {
    throw new HTTPException(401, { message: '请先登录' })
  }
  await next()
})
