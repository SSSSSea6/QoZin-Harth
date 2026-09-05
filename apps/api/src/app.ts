import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { auth } from './auth'
import { env } from './env'
import { sessionMiddleware } from './middleware/session'
import { circleToolsApp } from './routes/circle-tools'
import { circlesApp } from './routes/circles'
import { postsApp } from './routes/posts'
import { testHooksApp } from './routes/test-hooks'
import { toolApiApp } from './routes/tool-api'
import { toolStaticApp } from './routes/tool-static'
import { toolsApp } from './routes/tools'
import { usersApp } from './routes/users'
import { configureToolRuns } from './tools/runs'

export const app = new Hono()
  .use('/api/tool/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }))
  .use('/api/*', cors({ origin: env.WEB_URL, credentials: true }))
  .all('/api/auth/*', (c) => auth.handler(c.req.raw))
  .route('/api/tool', toolApiApp)
  .route('/', toolStaticApp)
  .use(sessionMiddleware)
  .get('/health', (c) => c.json({ ok: true }))
  .route('/api/circles', circlesApp)
  .route('/api/circles', circleToolsApp)
  .route('/api/posts', postsApp)
  .route('/api/users', usersApp)
  .route('/api/tools', toolsApp)

if (env.TEST_HOOKS) {
  app.route('/api/test', testHooksApp)
}

// 工具后端的数据访问也走这个 app，同一套令牌与权限
configureToolRuns(app)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: '服务器开小差了，稍后再试' }, 500)
})

export type AppType = typeof app
