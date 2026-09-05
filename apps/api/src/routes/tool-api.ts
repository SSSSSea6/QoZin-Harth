import {
  parsePostFields,
  TOOL_ACTION_INPUT_MAX_BYTES,
  TOOL_RUN_ERROR_CODES,
  TOOL_RUN_LIMITS,
  TOOL_STORAGE_MAX_KEYS,
  TOOL_STORAGE_VALUE_MAX_BYTES,
  toolActionNameSchema,
  toolStorageKeySchema,
  toolStorageWriteSchema,
  type ToolManifest,
  type ToolRunErrorCode,
  type ToolScope,
} from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, asc, count, desc, eq, like, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { circles, circleTools, memberships, posts, toolDevSessions, tools, toolStorage } from '../db/schema'
import { assertNotArchived, getMembership, mustGetCircle, touchCircle } from '../domain/circles'
import { createRun, manifestOf, queuedCount, waitForRun } from '../tools/runs'
import { currentVersion, getVersion } from '../tools/service'
import { verifyToolToken } from '../tools/token'

// kind：install 已安装、dev 开发会话、review 管理员试运行；byTool 的运行没有用户
interface Grant {
  userId: string | null
  circleId: string
  toolId: string
  scopes: ToolScope[]
  namespace: string
  byTool: boolean
  kind: 'install' | 'dev' | 'review'
  versionId: string | null
}

type ToolEnv = { Variables: { grant: Grant } }

const authenticate = createMiddleware<ToolEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HTTPException(401, { message: '缺少工具令牌' })
  let payload
  try {
    payload = await verifyToolToken(token)
  } catch {
    throw new HTTPException(401, { message: '令牌无效或已过期' })
  }
  const byTool = payload.by === 'tool'
  const grant: Grant = {
    userId: byTool ? null : payload.sub || null,
    circleId: payload.cid,
    toolId: payload.tid,
    scopes: payload.scopes,
    namespace: payload.dev ? `dev:${payload.sub}` : '',
    byTool,
    kind: payload.dev ? 'dev' : payload.review ? 'review' : 'install',
    versionId: payload.vid ?? null,
  }
  if (!grant.userId && !byTool) throw new HTTPException(401, { message: '令牌无效' })
  if (payload.dev) {
    const rows = await db
      .select({ expiresAt: toolDevSessions.expiresAt })
      .from(toolDevSessions)
      .where(
        and(
          eq(toolDevSessions.userId, payload.sub),
          eq(toolDevSessions.circleId, grant.circleId),
          eq(toolDevSessions.toolId, grant.toolId),
        ),
      )
      .limit(1)
    if (!rows[0] || rows[0].expiresAt < new Date()) {
      throw new HTTPException(403, { message: '本地开发会话已结束' })
    }
  } else if (!payload.review) {
    const [installed] = await db
      .update(circleTools)
      .set({ requests: sql`${circleTools.requests} + 1` })
      .where(and(eq(circleTools.circleId, grant.circleId), eq(circleTools.toolId, grant.toolId)))
      .returning({ installedAt: circleTools.installedAt, scopes: circleTools.scopes })
    if (!installed) throw new HTTPException(403, { message: '工具已从这个圈卸载' })
    if (payload.inst !== undefined && payload.inst !== installed.installedAt.getTime()) {
      throw new HTTPException(403, { message: '工具重新安装过，重新打开它' })
    }
    grant.scopes = payload.scopes.filter((scope) => installed.scopes.includes(scope))
  }
  c.set('grant', grant)
  await next()
})

function need(scope: ToolScope) {
  return createMiddleware<ToolEnv>(async (c, next) => {
    if (!c.get('grant').scopes.includes(scope)) {
      throw new HTTPException(403, { message: `工具没有申请「${scope}」权限` })
    }
    await next()
  })
}

// 归档的圈只读
async function writableCircle(circleId: string) {
  const circle = await mustGetCircle(circleId)
  assertNotArchived(circle)
  return circle
}

const keyParam = zValidator('param', z.object({ key: toolStorageKeySchema }))

function storageWhere(grant: Grant, key?: string) {
  return and(
    eq(toolStorage.toolId, grant.toolId),
    eq(toolStorage.circleId, grant.circleId),
    eq(toolStorage.namespace, grant.namespace),
    key === undefined ? undefined : eq(toolStorage.key, key),
  )
}

// 这次调用该用哪份清单：已安装用当前上架版本，开发会话用会话清单，试运行用令牌指定的版本
async function manifestFor(grant: Grant): Promise<{ manifest: ToolManifest; versionId: string | null }> {
  if (grant.kind === 'dev') {
    const [session] = await db
      .select({ manifest: toolDevSessions.manifest })
      .from(toolDevSessions)
      .where(and(eq(toolDevSessions.userId, grant.userId!), eq(toolDevSessions.toolId, grant.toolId), eq(toolDevSessions.circleId, grant.circleId)))
      .limit(1)
    if (!session) throw new HTTPException(403, { message: '本地开发会话已结束' })
    return { manifest: manifestOf(session.manifest), versionId: null }
  }
  if (grant.kind === 'review') {
    const version = grant.versionId ? await getVersion(grant.versionId) : null
    if (!version) throw new HTTPException(404, { message: '版本不存在' })
    return { manifest: manifestOf(version.manifest), versionId: version.id }
  }
  const [tool] = await db.select().from(tools).where(eq(tools.id, grant.toolId)).limit(1)
  const version = tool ? await currentVersion(tool) : null
  if (!version) throw new HTTPException(404, { message: '工具还没上架' })
  return { manifest: manifestOf(version.manifest), versionId: version.id }
}

export const toolApiApp = new Hono<ToolEnv>()
  .use(cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }))
  .use(authenticate)

  .get(
    '/storage',
    need('storage'),
    zValidator('query', z.object({ prefix: z.string().max(120).optional() })),
    async (c) => {
      const grant = c.get('grant')
      const { prefix } = c.req.valid('query')
      const rows = await db
        .select({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
        .from(toolStorage)
        .where(and(storageWhere(grant), prefix ? like(toolStorage.key, `${prefix.replaceAll('%', '\\%')}%`) : undefined))
        .orderBy(asc(toolStorage.key))
        .limit(200)
      return c.json({ items: rows })
    },
  )

  .get('/storage/:key', need('storage'), keyParam, async (c) => {
    const { key } = c.req.valid('param')
    const rows = await db
      .select({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
      .from(toolStorage)
      .where(storageWhere(c.get('grant'), key))
      .limit(1)
    if (!rows[0]) throw new HTTPException(404, { message: '没有这个键' })
    return c.json({ item: rows[0] })
  })

  .put('/storage/:key', need('storage'), keyParam, zValidator('json', toolStorageWriteSchema), async (c) => {
    const grant = c.get('grant')
    const { key } = c.req.valid('param')
    const { value, expectedVersion } = c.req.valid('json')
    if (JSON.stringify(value ?? null).length > TOOL_STORAGE_VALUE_MAX_BYTES) {
      throw new HTTPException(413, { message: `单个值不能超过 ${TOOL_STORAGE_VALUE_MAX_BYTES / 1024} KB` })
    }
    await writableCircle(grant.circleId)
    const item = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ version: toolStorage.version })
        .from(toolStorage)
        .where(storageWhere(grant, key))
        .limit(1)
      const current = existing[0]?.version ?? 0
      if (expectedVersion !== undefined && expectedVersion !== current) {
        throw new HTTPException(409, { message: `数据已被改动，当前版本 ${current}` })
      }
      if (!existing[0]) {
        const counted = await tx.select({ value: count() }).from(toolStorage).where(storageWhere(grant))
        if ((counted[0]?.value ?? 0) >= TOOL_STORAGE_MAX_KEYS) {
          throw new HTTPException(413, { message: `最多保存 ${TOOL_STORAGE_MAX_KEYS} 个键` })
        }
        const [row] = await tx
          .insert(toolStorage)
          .values({ toolId: grant.toolId, circleId: grant.circleId, namespace: grant.namespace, key, value: value ?? null })
          .returning({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
        return row!
      }
      const [row] = await tx
        .update(toolStorage)
        .set({ value: value ?? null, version: current + 1, updatedAt: new Date() })
        .where(and(storageWhere(grant, key), eq(toolStorage.version, current)))
        .returning({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
      if (!row) throw new HTTPException(409, { message: '数据刚被别人改过，请重试' })
      return row
    })
    return c.json({ item })
  })

  .delete('/storage/:key', need('storage'), keyParam, async (c) => {
    const grant = c.get('grant')
    const { key } = c.req.valid('param')
    await writableCircle(grant.circleId)
    await db.delete(toolStorage).where(storageWhere(grant, key))
    return c.json({ ok: true })
  })

  .get('/circle', need('circle.read'), async (c) => {
    const { circleId } = c.get('grant')
    const [circle] = await db.select({ id: circles.id, name: circles.name }).from(circles).where(eq(circles.id, circleId)).limit(1)
    const [members] = await db.select({ value: count() }).from(memberships).where(eq(memberships.circleId, circleId))
    return c.json({ circle: { ...circle!, memberCount: members?.value ?? 0 } })
  })

  .get('/members', need('members.read'), async (c) => {
    const { circleId } = c.get('grant')
    const rows = await db
      .select({ id: user.id, name: user.name, role: memberships.role, joinedAt: memberships.joinedAt })
      .from(memberships)
      .innerJoin(user, eq(memberships.userId, user.id))
      .where(eq(memberships.circleId, circleId))
      .orderBy(memberships.joinedAt)
    return c.json({ members: rows })
  })

  .get('/posts', need('posts.read'), async (c) => {
    const { circleId } = c.get('grant')
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        templateKey: posts.templateKey,
        fields: posts.fields,
        status: posts.status,
        createdAt: posts.createdAt,
        authorId: posts.authorId,
        authorName: user.name,
      })
      .from(posts)
      .leftJoin(user, eq(posts.authorId, user.id))
      .where(eq(posts.circleId, circleId))
      .orderBy(desc(posts.createdAt))
      .limit(50)
    return c.json({ posts: rows })
  })

  // 定时运行发的帖没有作者，只记工具；工具触发的写入不算圈子活跃
  .post(
    '/posts',
    need('posts.write'),
    zValidator('json', z.object({ title: z.string(), body: z.string().optional() })),
    async (c) => {
      const grant = c.get('grant')
      const parsed = parsePostFields('discussion', c.req.valid('json'))
      if (!parsed) throw new HTTPException(400, { message: '标题或正文不合法' })
      await writableCircle(grant.circleId)
      const [post] = await db
        .insert(posts)
        .values({
          circleId: grant.circleId,
          templateKey: 'discussion',
          authorId: grant.userId,
          title: parsed.title,
          fields: parsed.fields,
          toolId: grant.toolId,
        })
        .returning({ id: posts.id })
      if (!grant.byTool) await touchCircle(grant.circleId)
      return c.json({ post: { id: post!.id } }, 201)
    },
  )

  // 前端调用工具自己的后端动作，同步等结果
  .post(
    '/actions/:name',
    zValidator('param', z.object({ name: toolActionNameSchema })),
    zValidator('json', z.object({ input: z.unknown().optional() })),
    async (c) => {
      const grant = c.get('grant')
      const { name } = c.req.valid('param')
      const input = c.req.valid('json').input ?? null
      if (!grant.userId) throw new HTTPException(403, { message: '定时运行里不能再调用动作' })
      if (JSON.stringify(input).length > TOOL_ACTION_INPUT_MAX_BYTES) {
        throw new HTTPException(413, { message: `参数不能超过 ${TOOL_ACTION_INPUT_MAX_BYTES / 1024} KB` })
      }
      if (!(await getMembership(grant.circleId, grant.userId))) {
        throw new HTTPException(403, { message: '你已不在这个圈子里' })
      }
      const { manifest, versionId } = await manifestFor(grant)
      const action = manifest.actions.find((a) => a.name === name)
      if (!action || !action.triggers.includes('call')) throw new HTTPException(404, { message: '没有这个动作' })
      if ((await queuedCount()) >= TOOL_RUN_LIMITS.queue) throw new HTTPException(503, { message: '工具繁忙，稍后再试' })
      const run = await createRun({
        toolId: grant.toolId,
        circleId: grant.circleId,
        versionId,
        environment: grant.kind === 'dev' ? 'dev' : 'prod',
        trigger: 'call',
        action: name,
        input,
        userId: grant.userId,
      })
      const done = await waitForRun(run.id, TOOL_RUN_LIMITS.totalMs + 5_000)
      if (done.status === 'ok') return c.json({ result: done.result ?? null })
      if (done.status === 'queued' || done.status === 'running') {
        throw new HTTPException(503, { message: '工具繁忙，稍后再试' })
      }
      const code = (done.errorCode ?? 'HOST_ERROR') as ToolRunErrorCode
      return c.json({ error: done.error ?? TOOL_RUN_ERROR_CODES[code], code }, 422)
    },
  )
