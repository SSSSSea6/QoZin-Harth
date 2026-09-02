import {
  createCircleInput,
  DORMANCY_DAYS_BY_DEPTH,
  DORMANCY_DAYS_DM,
  MAX_CIRCLE_DEPTH,
  messageInput,
  TEMPLATES,
  templateKeySchema,
} from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import {
  circleParents,
  circles,
  circleTemplates,
  memberships,
  messages,
} from '../db/schema'
import {
  assertNotArchived,
  canSee,
  getMembership,
  memberCircleIds,
  mustGetCircle,
  mustGetMembership,
  parentIdsOf,
  touchCircle,
} from '../domain/circles'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

function randomInviteCode(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 8)
}

function assertDm(circle: { isDm: boolean }): void {
  if (!circle.isDm) {
    throw new HTTPException(400, { message: '圈内交流请发帖' })
  }
}

function lifecycleView(circle: {
  hibernationDeadline: Date | null
  archivedAt: Date | null
}) {
  if (circle.archivedAt) return { state: 'archived' as const }
  if (circle.hibernationDeadline) {
    return {
      state: 'hibernating' as const,
      deadline: circle.hibernationDeadline,
    }
  }
  return { state: 'active' as const }
}

export const circlesApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/mine', async (c) => {
    const userId = c.get('user')!.id
    const rows = await db
      .select({ circle: circles, role: memberships.role })
      .from(memberships)
      .innerJoin(circles, eq(memberships.circleId, circles.id))
      .where(eq(memberships.userId, userId))
      .orderBy(desc(circles.lastActivityAt))
    const result = []
    for (const { circle, role } of rows) {
      let displayName = circle.name
      if (circle.isDm) {
        const members = await db
          .select({ name: user.name, id: user.id })
          .from(memberships)
          .innerJoin(user, eq(memberships.userId, user.id))
          .where(eq(memberships.circleId, circle.id))
        const peer = members.find((m) => m.id !== userId)
        displayName = peer?.name ?? circle.name
      }
      result.push({
        id: circle.id,
        name: displayName,
        isDm: circle.isDm,
        isOfficial: circle.isOfficial,
        visibility: circle.visibility,
        depth: circle.depth,
        role,
        lastActivityAt: circle.lastActivityAt,
        lifecycle: lifecycleView(circle),
      })
    }
    return c.json({ circles: result })
  })

  .get('/top', async (c) => {
    const userId = c.get('user')!.id
    const rows = await db
      .select()
      .from(circles)
      .where(and(eq(circles.isOfficial, true), isNull(circles.archivedAt)))
      .orderBy(desc(circles.lastActivityAt))
    const mine = await memberCircleIds(
      userId,
      rows.map((r) => r.id),
    )
    return c.json({
      circles: rows.map((r) => ({
        id: r.id,
        name: r.name,
        joined: mine.has(r.id),
      })),
    })
  })

  .post('/', zValidator('json', createCircleInput), async (c) => {
    const userId = c.get('user')!.id
    const input = c.req.valid('json')

    const parentIds = [...new Set(input.parentIds)]
    const parents = await db
      .select()
      .from(circles)
      .where(inArray(circles.id, parentIds))
    if (parents.length !== parentIds.length) {
      throw new HTTPException(404, { message: '父圈不存在' })
    }
    for (const parent of parents) {
      if (parent.isDm) throw new HTTPException(400, { message: '不能挂靠到双人圈' })
      if (parent.archivedAt) {
        throw new HTTPException(409, { message: `父圈「${parent.name}」已归档` })
      }
    }
    const memberOf = await memberCircleIds(userId, parentIds)
    for (const parent of parents) {
      if (!memberOf.has(parent.id)) {
        throw new HTTPException(403, {
          message: `先加入「${parent.name}」才能在它下面建圈`,
        })
      }
    }
    const depth = Math.max(...parents.map((p) => p.depth ?? 1)) + 1
    if (depth > MAX_CIRCLE_DEPTH) {
      throw new HTTPException(400, {
        message: `最多 ${MAX_CIRCLE_DEPTH} 层：身份圈 → 社群圈 → 行动圈`,
      })
    }

    const created = await db.transaction(async (tx) => {
      const [circle] = await tx
        .insert(circles)
        .values({
          name: input.name,
          visibility: input.visibility,
          depth,
          dormancyDays: DORMANCY_DAYS_BY_DEPTH[depth] ?? null,
          inviteCode: input.visibility === 'private' ? randomInviteCode() : null,
          createdBy: userId,
        })
        .returning()
      await tx.insert(circleParents).values(
        parentIds.map((parentId) => ({ circleId: circle!.id, parentId })),
      )
      await tx.insert(memberships).values({
        circleId: circle!.id,
        userId,
        role: 'owner',
      })
      return circle!
    })
    return c.json({ circle: { id: created.id, name: created.name } }, 201)
  })

  .post(
    '/dm',
    zValidator('json', z.object({ userId: z.string() })),
    async (c) => {
      const me = c.get('user')!.id
      const { userId: target } = c.req.valid('json')
      if (target === me) {
        throw new HTTPException(400, { message: '不能和自己建双人圈' })
      }
      const targetUser = await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(eq(user.id, target))
        .limit(1)
      if (!targetUser[0]) throw new HTTPException(404, { message: '用户不存在' })

      const dmKey = [me, target].sort().join(':')
      const existing = await db
        .select()
        .from(circles)
        .where(eq(circles.dmKey, dmKey))
        .limit(1)
      if (existing[0]) return c.json({ circle: { id: existing[0].id } })

      const created = await db.transaction(async (tx) => {
        const [circle] = await tx
          .insert(circles)
          .values({
            name: `${targetUser[0]!.name}`,
            visibility: 'private',
            isDm: true,
            dmKey,
            dormancyDays: DORMANCY_DAYS_DM,
            createdBy: me,
          })
          .returning()
        await tx.insert(memberships).values([
          { circleId: circle!.id, userId: me, role: 'owner' },
          { circleId: circle!.id, userId: target, role: 'member' },
        ])
        return circle!
      })
      return c.json({ circle: { id: created.id } }, 201)
    },
  )

  // 成员看全量，可见的非成员看预览，私密圈凭邀请码预览
  .get(
    '/:id',
    zValidator('query', z.object({ inviteCode: z.string().optional() })),
    async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    const membership = await getMembership(circle.id, userId)

    const hasInvite =
      circle.visibility === 'private' &&
      !circle.isDm &&
      c.req.valid('query').inviteCode === circle.inviteCode
    if (!membership && !hasInvite && !(await canSee(circle, userId))) {
      throw new HTTPException(404, { message: '圈子不存在' })
    }

    const memberRows = await db
      .select({ value: count() })
      .from(memberships)
      .where(eq(memberships.circleId, circle.id))
    const members = memberRows[0]?.value ?? 0

    const enabledTemplates = await db
      .select({ templateKey: circleTemplates.templateKey })
      .from(circleTemplates)
      .where(eq(circleTemplates.circleId, circle.id))

    let displayName = circle.name
    let peerId: string | null = null
    if (circle.isDm) {
      const others = await db
        .select({ id: user.id, name: user.name })
        .from(memberships)
        .innerJoin(user, eq(memberships.userId, user.id))
        .where(eq(memberships.circleId, circle.id))
      const peer = others.find((m) => m.id !== userId)
      displayName = peer?.name ?? circle.name
      peerId = peer?.id ?? null
    }

    return c.json({
      circle: {
        id: circle.id,
        name: displayName,
        isDm: circle.isDm,
        peerId,
        isOfficial: circle.isOfficial,
        visibility: circle.visibility,
        depth: circle.depth,
        memberCount: members,
        lifecycle: lifecycleView(circle),
        dormancyDays: circle.dormancyDays,
        myRole: membership?.role ?? null,
        inviteCode: membership?.role === 'owner' ? circle.inviteCode : null,
        templates: enabledTemplates.map((t) => t.templateKey),
      },
    })
  })

  // 官方圈直接加入，公开圈须属于任一父圈，私密圈凭邀请码
  .post(
    '/:id/join',
    zValidator('json', z.object({ inviteCode: z.string().optional() })),
    async (c) => {
      const userId = c.get('user')!.id
      const circle = await mustGetCircle(c.req.param('id'))
      assertNotArchived(circle)
      if (circle.isDm) throw new HTTPException(400, { message: '双人圈不可加入' })
      if (await getMembership(circle.id, userId)) {
        return c.json({ joined: true })
      }

      if (circle.visibility === 'private') {
        const { inviteCode } = c.req.valid('json')
        if (!inviteCode || inviteCode !== circle.inviteCode) {
          throw new HTTPException(403, { message: '邀请码不对' })
        }
      } else if (!circle.isOfficial) {
        const parents = await parentIdsOf(circle.id)
        const mine = await memberCircleIds(userId, parents)
        if (mine.size === 0) {
          throw new HTTPException(403, { message: '先加入它的上级圈子' })
        }
      }

      await db.insert(memberships).values({ circleId: circle.id, userId })
      await touchCircle(circle.id)
      return c.json({ joined: true }, 201)
    },
  )

  .post('/:id/leave', async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    if (circle.isDm) throw new HTTPException(400, { message: '双人圈随沉寂自然熄灭' })
    await mustGetMembership(circle.id, userId)
    await db
      .delete(memberships)
      .where(
        and(eq(memberships.circleId, circle.id), eq(memberships.userId, userId)),
      )
    return c.json({ left: true })
  })

  .post('/:id/renew', async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    assertNotArchived(circle)
    await mustGetMembership(circle.id, userId)
    await touchCircle(circle.id)
    return c.json({ renewed: true })
  })

  .get('/:id/members', async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    await mustGetMembership(circle.id, userId)
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        role: memberships.role,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(user, eq(memberships.userId, user.id))
      .where(eq(memberships.circleId, circle.id))
      .orderBy(memberships.joinedAt)
    return c.json({ members: rows })
  })

  // 公开且未归档的子圈，按活跃时间排序
  .get('/:id/children', async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    await mustGetMembership(circle.id, userId)
    const children = await db
      .select({ circle: circles })
      .from(circleParents)
      .innerJoin(circles, eq(circleParents.circleId, circles.id))
      .where(
        and(
          eq(circleParents.parentId, circle.id),
          eq(circles.visibility, 'public'),
          isNull(circles.archivedAt),
        ),
      )
      .orderBy(desc(circles.lastActivityAt))
    const mine = await memberCircleIds(
      userId,
      children.map((r) => r.circle.id),
    )
    return c.json({
      circles: children.map(({ circle: ch }) => ({
        id: ch.id,
        name: ch.name,
        depth: ch.depth,
        lastActivityAt: ch.lastActivityAt,
        lifecycle: lifecycleView(ch),
        joined: mine.has(ch.id),
      })),
    })
  })

  .put(
    '/:id/templates/:key',
    zValidator('json', z.object({ enabled: z.boolean() })),
    async (c) => {
      const userId = c.get('user')!.id
      const circle = await mustGetCircle(c.req.param('id'))
      assertNotArchived(circle)
      if (circle.isDm) {
        throw new HTTPException(400, { message: '双人圈没有供需能力' })
      }
      const key = templateKeySchema.parse(c.req.param('key'))
      const membership = await mustGetMembership(circle.id, userId)
      if (membership.role !== 'owner') {
        throw new HTTPException(403, { message: '只有圈主能配置能力' })
      }
      const { enabled } = c.req.valid('json')
      if (enabled) {
        await db
          .insert(circleTemplates)
          .values({ circleId: circle.id, templateKey: key, enabledBy: userId })
          .onConflictDoNothing()
      } else {
        await db
          .delete(circleTemplates)
          .where(
            and(
              eq(circleTemplates.circleId, circle.id),
              eq(circleTemplates.templateKey, key),
            ),
          )
      }
      return c.json({ key, enabled, name: TEMPLATES[key].name })
    },
  )

  .get(
    '/:id/messages',
    zValidator(
      'query',
      z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
    ),
    async (c) => {
      const userId = c.get('user')!.id
      const circle = await mustGetCircle(c.req.param('id'))
      assertDm(circle)
      await mustGetMembership(circle.id, userId)
      const { before, limit } = c.req.valid('query')

      const conditions = [eq(messages.circleId, circle.id)]
      if (before) {
        const anchor = await db
          .select({ createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.id, before))
          .limit(1)
        if (anchor[0]) conditions.push(lt(messages.createdAt, anchor[0].createdAt))
      }
      const rows = await db
        .select({
          id: messages.id,
          content: messages.content,
          replyToId: messages.replyToId,
          createdAt: messages.createdAt,
          authorId: user.id,
          authorName: user.name,
        })
        .from(messages)
        .innerJoin(user, eq(messages.authorId, user.id))
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(limit)
      return c.json({ messages: rows })
    },
  )

  .post('/:id/messages', zValidator('json', messageInput), async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    assertDm(circle)
    assertNotArchived(circle)
    await mustGetMembership(circle.id, userId)
    const input = c.req.valid('json')
    const [row] = await db
      .insert(messages)
      .values({
        circleId: circle.id,
        authorId: userId,
        content: input.content,
        replyToId: input.replyToId ?? null,
      })
      .returning()
    await touchCircle(circle.id)
    return c.json({ message: row }, 201)
  })
