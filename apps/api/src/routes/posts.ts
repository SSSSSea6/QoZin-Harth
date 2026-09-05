import {
  commentInput,
  createPostInput,
  parsePostFields,
  responseInput,
  reviewInput,
  TEMPLATES,
  templateKeySchema,
} from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import {
  circles,
  circleTemplates,
  comments,
  memberships,
  posts,
  responses,
  reviews,
  tools,
} from '../db/schema'
import {
  assertNotArchived,
  mustGetCircle,
  mustGetMembership,
  touchCircle,
} from '../domain/circles'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

type PostRow = typeof posts.$inferSelect

const commentCount = sql<number>`(select count(*) from ${comments} where ${comments.postId} = ${posts.id})`.mapWith(Number)
const responseCount = sql<number>`(select count(*) from ${responses} where ${responses.postId} = ${posts.id})`.mapWith(Number)

// 定时运行发的帖没有作者，列表用工具名显示
const listColumns = {
  id: posts.id,
  circleId: posts.circleId,
  circleName: circles.name,
  templateKey: posts.templateKey,
  title: posts.title,
  fields: posts.fields,
  status: posts.status,
  createdAt: posts.createdAt,
  authorId: posts.authorId,
  authorName: user.name,
  toolSlug: tools.slug,
  toolName: tools.name,
  commentCount,
  responseCount,
}

async function mustGetPost(id: string): Promise<PostRow> {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
  if (!rows[0]) throw new HTTPException(404, { message: '帖子不存在' })
  return rows[0]
}

async function matchedResponderId(post: PostRow): Promise<string | null> {
  if (!post.matchedResponseId) return null
  const rows = await db
    .select({ responderId: responses.responderId })
    .from(responses)
    .where(eq(responses.id, post.matchedResponseId))
    .limit(1)
  return rows[0]?.responderId ?? null
}

async function createdAtOf(postId: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: posts.createdAt })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1)
  return rows[0]?.createdAt ?? null
}

export const postsApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get(
    '/feed',
    zValidator('query', z.object({ before: z.string().optional() })),
    async (c) => {
      const userId = c.get('user')!.id
      const { before } = c.req.valid('query')
      const anchor = before ? await createdAtOf(before) : null

      const rows = await db
        .select(listColumns)
        .from(posts)
        .innerJoin(
          memberships,
          and(
            eq(memberships.circleId, posts.circleId),
            eq(memberships.userId, userId),
          ),
        )
        .innerJoin(circles, eq(circles.id, posts.circleId))
        .leftJoin(user, eq(posts.authorId, user.id))
        .leftJoin(tools, eq(posts.toolId, tools.id))
        .where(anchor ? lt(posts.createdAt, anchor) : undefined)
        .orderBy(desc(posts.createdAt))
        .limit(30)
      return c.json({ posts: rows })
    },
  )

  // 讨论帖默认可发，其他模板须在圈内启用
  .post(
    '/circles/:circleId',
    zValidator('json', createPostInput),
    async (c) => {
      const userId = c.get('user')!.id
      const circle = await mustGetCircle(c.req.param('circleId'))
      assertNotArchived(circle)
      if (circle.isDm) throw new HTTPException(400, { message: '双人圈不发帖' })
      await mustGetMembership(circle.id, userId)
      const input = c.req.valid('json')

      if (!TEMPLATES[input.templateKey].alwaysEnabled) {
        const enabled = await db
          .select()
          .from(circleTemplates)
          .where(
            and(
              eq(circleTemplates.circleId, circle.id),
              eq(circleTemplates.templateKey, input.templateKey),
            ),
          )
          .limit(1)
        if (!enabled[0]) {
          throw new HTTPException(400, { message: '这个圈子没有启用该能力' })
        }
      }

      const parsed = parsePostFields(input.templateKey, input.fields)
      if (!parsed) {
        throw new HTTPException(400, { message: '字段不完整或不合法' })
      }

      const [post] = await db
        .insert(posts)
        .values({
          circleId: circle.id,
          templateKey: input.templateKey,
          authorId: userId,
          title: parsed.title,
          fields: parsed.fields,
        })
        .returning()
      await touchCircle(circle.id)
      return c.json({ post: { id: post!.id } }, 201)
    },
  )

  .get(
    '/circles/:circleId',
    zValidator(
      'query',
      z.object({
        templateKey: templateKeySchema.optional(),
        before: z.string().optional(),
      }),
    ),
    async (c) => {
      const userId = c.get('user')!.id
      const circle = await mustGetCircle(c.req.param('circleId'))
      await mustGetMembership(circle.id, userId)
      const { templateKey, before } = c.req.valid('query')
      const anchor = before ? await createdAtOf(before) : null

      const conditions = [eq(posts.circleId, circle.id)]
      if (templateKey) conditions.push(eq(posts.templateKey, templateKey))
      if (anchor) conditions.push(lt(posts.createdAt, anchor))

      const rows = await db
        .select(listColumns)
        .from(posts)
        .innerJoin(circles, eq(circles.id, posts.circleId))
        .leftJoin(user, eq(posts.authorId, user.id))
        .leftJoin(tools, eq(posts.toolId, tools.id))
        .where(and(...conditions))
        .orderBy(desc(posts.createdAt))
        .limit(30)
      return c.json({ posts: rows })
    },
  )

  // 应答列表作者看全部，其他人只看自己的
  .get('/:id', async (c) => {
    const userId = c.get('user')!.id
    const post = await mustGetPost(c.req.param('id'))
    const circle = await mustGetCircle(post.circleId)
    await mustGetMembership(circle.id, userId)

    const isAuthor = post.authorId === userId
    const responderId = await matchedResponderId(post)

    const allResponses = await db
      .select({
        id: responses.id,
        message: responses.message,
        createdAt: responses.createdAt,
        responderId: user.id,
        responderName: user.name,
      })
      .from(responses)
      .innerJoin(user, eq(responses.responderId, user.id))
      .where(eq(responses.postId, post.id))
      .orderBy(responses.createdAt)

    const visibleResponses = isAuthor
      ? allResponses
      : allResponses.filter((r) => r.responderId === userId)

    const postComments = await db
      .select({
        id: comments.id,
        content: comments.content,
        createdAt: comments.createdAt,
        authorId: user.id,
        authorName: user.name,
      })
      .from(comments)
      .innerJoin(user, eq(comments.authorId, user.id))
      .where(eq(comments.postId, post.id))
      .orderBy(comments.createdAt)

    const [author] = post.authorId
      ? await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, post.authorId)).limit(1)
      : []
    const [tool] = post.toolId
      ? await db.select({ slug: tools.slug, name: tools.name }).from(tools).where(eq(tools.id, post.toolId)).limit(1)
      : []

    const myReview = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.postId, post.id), eq(reviews.reviewerId, userId)))
      .limit(1)

    return c.json({
      post: {
        id: post.id,
        circleId: post.circleId,
        circleName: circle.name,
        circleArchived: circle.archivedAt !== null,
        templateKey: post.templateKey,
        title: post.title,
        fields: post.fields,
        status: post.status,
        createdAt: post.createdAt,
        author: author ?? null,
        tool: tool ?? null,
        isAuthor,
        matchedResponseId: post.matchedResponseId,
        matchedResponderId: responderId,
        iAmMatchedResponder: responderId === userId,
        authorConfirmed: post.authorConfirmedAt !== null,
        responderConfirmed: post.responderConfirmedAt !== null,
        completedAt: post.completedAt,
        responseCount: allResponses.length,
        responses: visibleResponses,
        comments: postComments,
        reviewedByMe: myReview.length > 0,
      },
    })
  })

  .post('/:id/comments', zValidator('json', commentInput), async (c) => {
    const userId = c.get('user')!.id
    const post = await mustGetPost(c.req.param('id'))
    const circle = await mustGetCircle(post.circleId)
    assertNotArchived(circle)
    await mustGetMembership(circle.id, userId)
    const { content } = c.req.valid('json')
    const [row] = await db
      .insert(comments)
      .values({ postId: post.id, authorId: userId, content })
      .returning()
    await touchCircle(circle.id)
    return c.json({ comment: { id: row!.id } }, 201)
  })

  .post('/:id/responses', zValidator('json', responseInput), async (c) => {
    const userId = c.get('user')!.id
    const post = await mustGetPost(c.req.param('id'))
    const circle = await mustGetCircle(post.circleId)
    assertNotArchived(circle)
    await mustGetMembership(circle.id, userId)
    if (post.templateKey === 'discussion') {
      throw new HTTPException(400, { message: '讨论帖直接回复即可' })
    }
    if (post.status !== 'open') {
      throw new HTTPException(409, { message: '帖子已不在开放状态' })
    }
    if (post.authorId === userId) {
      throw new HTTPException(400, { message: '不能应答自己的帖子' })
    }
    const { message } = c.req.valid('json')
    const inserted = await db
      .insert(responses)
      .values({ postId: post.id, responderId: userId, message })
      .onConflictDoNothing()
      .returning()
    if (!inserted[0]) {
      throw new HTTPException(409, { message: '你已经应答过了' })
    }
    await touchCircle(circle.id)
    return c.json({ response: { id: inserted[0].id } }, 201)
  })

  .post(
    '/:id/accept',
    zValidator('json', z.object({ responseId: z.string() })),
    async (c) => {
      const userId = c.get('user')!.id
      const post = await mustGetPost(c.req.param('id'))
      if (post.authorId !== userId) {
        throw new HTTPException(403, { message: '只有发布者能选定应答' })
      }
      if (post.status !== 'open') {
        throw new HTTPException(409, { message: '帖子已不在开放状态' })
      }
      const { responseId } = c.req.valid('json')
      const response = await db
        .select()
        .from(responses)
        .where(and(eq(responses.id, responseId), eq(responses.postId, post.id)))
        .limit(1)
      if (!response[0]) throw new HTTPException(404, { message: '应答不存在' })

      await db
        .update(posts)
        .set({ status: 'matched', matchedResponseId: responseId })
        .where(eq(posts.id, post.id))
      await touchCircle(post.circleId)
      return c.json({ status: 'matched' })
    },
  )

  .post('/:id/confirm', async (c) => {
    const userId = c.get('user')!.id
    const post = await mustGetPost(c.req.param('id'))
    if (post.status !== 'matched') {
      throw new HTTPException(409, { message: '还没有选定应答' })
    }
    const responderId = await matchedResponderId(post)

    let patch: Partial<typeof posts.$inferInsert>
    if (userId === post.authorId) {
      patch = { authorConfirmedAt: post.authorConfirmedAt ?? new Date() }
    } else if (userId === responderId) {
      patch = { responderConfirmedAt: post.responderConfirmedAt ?? new Date() }
    } else {
      throw new HTTPException(403, { message: '只有交易双方能确认' })
    }

    const authorDone =
      userId === post.authorId || post.authorConfirmedAt !== null
    const responderDone =
      userId === responderId || post.responderConfirmedAt !== null
    if (authorDone && responderDone) {
      patch.status = 'completed'
      patch.completedAt = new Date()
    }

    await db.update(posts).set(patch).where(eq(posts.id, post.id))
    await touchCircle(post.circleId)
    return c.json({
      status: authorDone && responderDone ? 'completed' : 'matched',
    })
  })

  .post('/:id/cancel', async (c) => {
    const userId = c.get('user')!.id
    const post = await mustGetPost(c.req.param('id'))
    if (post.authorId !== userId) {
      throw new HTTPException(403, { message: '只有发布者能取消' })
    }
    if (post.status === 'completed') {
      throw new HTTPException(409, { message: '已完成的交易不能取消' })
    }
    await db
      .update(posts)
      .set({ status: 'cancelled' })
      .where(eq(posts.id, post.id))
    return c.json({ status: 'cancelled' })
  })

  .post('/:id/reviews', zValidator('json', reviewInput), async (c) => {
    const userId = c.get('user')!.id
    const post = await mustGetPost(c.req.param('id'))
    if (post.status !== 'completed') {
      throw new HTTPException(409, { message: '成交后才能互评' })
    }
    const responderId = await matchedResponderId(post)
    let revieweeId: string
    if (userId === post.authorId) revieweeId = responderId!
    else if (userId === responderId && post.authorId) revieweeId = post.authorId
    else throw new HTTPException(403, { message: '只有交易双方能互评' })

    const { rating, comment } = c.req.valid('json')
    const inserted = await db
      .insert(reviews)
      .values({
        postId: post.id,
        reviewerId: userId,
        revieweeId,
        rating,
        comment: comment ?? null,
      })
      .onConflictDoNothing()
      .returning()
    if (!inserted[0]) {
      throw new HTTPException(409, { message: '你已经评价过了' })
    }
    return c.json({ review: { id: inserted[0].id } }, 201)
  })
