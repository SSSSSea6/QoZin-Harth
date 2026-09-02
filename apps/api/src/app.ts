import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { auth } from './auth'
import { env } from './env'
import { sessionMiddleware } from './middleware/session'
import { circlesApp } from './routes/circles'
import { postsApp } from './routes/posts'
import { testHooksApp } from './routes/test-hooks'
import { usersApp } from './routes/users'

export const app = new Hono()
  .use('/api/*', cors({ origin: env.WEB_URL, credentials: true }))
  .all('/api/auth/*', (c) => auth.handler(c.req.raw))
  .use(sessionMiddleware)
  .get('/health', (c) => c.json({ ok: true }))
  .route('/api/circles', circlesApp)
  .route('/api/posts', postsApp)
  .route('/api/users', usersApp)

if (env.TEST_HOOKS) {
  app.route('/api/test', testHooksApp)
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: '服务器开小差了，稍后再试' }, 500)
})

export type AppType = typeof app
