import {
  parsePostFields,
  TOOL_STORAGE_MAX_KEYS,
  TOOL_STORAGE_VALUE_MAX_BYTES,
  toolStorageKeySchema,
  toolStorageWriteSchema,
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
import { circles, circleTools, memberships, posts, toolDevSessions, toolStorage } from '../db/schema'
import { touchCircle } from '../domain/circles'
import { verifyToolToken } from '../tools/token'

interface Grant {
  userId: string
  circleId: string
  toolId: string
  scopes: ToolScope[]
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
  const grant: Grant = {
    userId: payload.sub,
    circleId: payload.cid,
    toolId: payload.tid,
    scopes: payload.scopes,
  }
  if (payload.dev) {
    const rows = await db
      .select({ expiresAt: toolDevSessions.expiresAt })
      .from(toolDevSessions)
      .where(
        and(
          eq(toolDevSessions.userId, grant.userId),
          eq(toolDevSessions.circleId, grant.circleId),
          eq(toolDevSessions.toolId, grant.toolId),
        ),
      )
      .limit(1)
    if (!rows[0] || rows[0].expiresAt < new Date()) {
      throw new HTTPException(403, { message: '本地开发会话已结束' })
    }
  } else {
    const updated = await db
      .update(circleTools)
      .set({ requests: sql`${circleTools.requests} + 1` })
      .where(and(eq(circleTools.circleId, grant.circleId), eq(circleTools.toolId, grant.toolId)))
      .returning({ circleId: circleTools.circleId })
    if (!updated[0]) throw new HTTPException(403, { message: '工具已从这个圈卸载' })
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

const keyParam = zValidator('param', z.object({ key: toolStorageKeySchema }))

export const toolApiApp = new Hono<ToolEnv>()
  .use(cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }))
  .use(authenticate)

  .get(
    '/storage',
    need('storage'),
    zValidator('query', z.object({ prefix: z.string().max(120).optional() })),
    async (c) => {
      const { toolId, circleId } = c.get('grant')
      const { prefix } = c.req.valid('query')
      const rows = await db
        .select({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
        .from(toolStorage)
        .where(
          and(
            eq(toolStorage.toolId, toolId),
            eq(toolStorage.circleId, circleId),
            prefix ? like(toolStorage.key, `${prefix.replaceAll('%', '\\%')}%`) : undefined,
          ),
        )
        .orderBy(asc(toolStorage.key))
        .limit(200)
      return c.json({ items: rows })
    },
  )

  .get('/storage/:key', need('storage'), keyParam, async (c) => {
    const { toolId, circleId } = c.get('grant')
    const { key } = c.req.valid('param')
    const rows = await db
      .select({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
      .from(toolStorage)
      .where(and(eq(toolStorage.toolId, toolId), eq(toolStorage.circleId, circleId), eq(toolStorage.key, key)))
      .limit(1)
    if (!rows[0]) throw new HTTPException(404, { message: '没有这个键' })
    return c.json({ item: rows[0] })
  })

  .put('/storage/:key', need('storage'), keyParam, zValidator('json', toolStorageWriteSchema), async (c) => {
    const { toolId, circleId } = c.get('grant')
    const { key } = c.req.valid('param')
    const { value, expectedVersion } = c.req.valid('json')
    if (JSON.stringify(value ?? null).length > TOOL_STORAGE_VALUE_MAX_BYTES) {
      throw new HTTPException(413, { message: `单个值不能超过 ${TOOL_STORAGE_VALUE_MAX_BYTES / 1024} KB` })
    }
    const item = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ version: toolStorage.version })
        .from(toolStorage)
        .where(and(eq(toolStorage.toolId, toolId), eq(toolStorage.circleId, circleId), eq(toolStorage.key, key)))
        .limit(1)
      const current = existing[0]?.version ?? 0
      if (expectedVersion !== undefined && expectedVersion !== current) {
        throw new HTTPException(409, { message: `数据已被改动，当前版本 ${current}` })
      }
      if (!existing[0]) {
        const counted = await tx
          .select({ value: count() })
          .from(toolStorage)
          .where(and(eq(toolStorage.toolId, toolId), eq(toolStorage.circleId, circleId)))
        if ((counted[0]?.value ?? 0) >= TOOL_STORAGE_MAX_KEYS) {
          throw new HTTPException(413, { message: `最多保存 ${TOOL_STORAGE_MAX_KEYS} 个键` })
        }
        const [row] = await tx
          .insert(toolStorage)
          .values({ toolId, circleId, key, value: value ?? null })
          .returning({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
        return row!
      }
      const [row] = await tx
        .update(toolStorage)
        .set({ value: value ?? null, version: current + 1, updatedAt: new Date() })
        .where(
          and(
            eq(toolStorage.toolId, toolId),
            eq(toolStorage.circleId, circleId),
            eq(toolStorage.key, key),
            eq(toolStorage.version, current),
          ),
        )
        .returning({ key: toolStorage.key, value: toolStorage.value, version: toolStorage.version })
      if (!row) throw new HTTPException(409, { message: '数据刚被别人改过，请重试' })
      return row
    })
    return c.json({ item })
  })

  .delete('/storage/:key', need('storage'), keyParam, async (c) => {
    const { toolId, circleId } = c.get('grant')
    const { key } = c.req.valid('param')
    await db
      .delete(toolStorage)
      .where(and(eq(toolStorage.toolId, toolId), eq(toolStorage.circleId, circleId), eq(toolStorage.key, key)))
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
      .innerJoin(user, eq(posts.authorId, user.id))
      .where(eq(posts.circleId, circleId))
      .orderBy(desc(posts.createdAt))
      .limit(50)
    return c.json({ posts: rows })
  })

  .post(
    '/posts',
    need('posts.write'),
    zValidator('json', z.object({ title: z.string(), body: z.string().optional() })),
    async (c) => {
      const { userId, circleId, toolId } = c.get('grant')
      const parsed = parsePostFields('discussion', c.req.valid('json'))
      if (!parsed) throw new HTTPException(400, { message: '标题或正文不合法' })
      const [post] = await db
        .insert(posts)
        .values({
          circleId,
          templateKey: 'discussion',
          authorId: userId,
          title: parsed.title,
          fields: parsed.fields,
          toolId,
        })
        .returning({ id: posts.id })
      await touchCircle(circleId)
      return c.json({ post: { id: post!.id } }, 201)
    },
  )
