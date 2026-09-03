import { zValidator } from '@hono/zod-validator'
import { and, avg, count, desc, eq, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { auth } from '../auth'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { posts, responses, reviews } from '../db/schema'
import { deleteAccount, exportAccount } from '../domain/account'
import { requireAuth } from '../middleware/session'
import type { AppEnv } from '../types'

export const usersApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/me/export', async (c) => {
    const data = await exportAccount(c.get('user')!.id)
    const day = data.exportedAt.slice(0, 10)
    return c.body(JSON.stringify(data, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="harth-${day}.json"`,
    })
  })

  .post('/me/delete', zValidator('json', z.object({ password: z.string().min(1) })), async (c) => {
    const me = c.get('user')!
    try {
      await auth.api.signInEmail({ body: { email: me.email, password: c.req.valid('json').password } })
    } catch {
      throw new HTTPException(403, { message: '密码不对' })
    }
    await deleteAccount(me.id)
    return c.json({ deleted: true })
  })

  .get('/:id/profile', async (c) => {
    const id = c.req.param('id')
    const [profile] = await db
      .select({ id: user.id, name: user.name, createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, id))
      .limit(1)
    if (!profile) throw new HTTPException(404, { message: '用户不存在' })

    const [reputation] = await db
      .select({ avgRating: avg(reviews.rating), reviewCount: count() })
      .from(reviews)
      .where(eq(reviews.revieweeId, id))

    const [completed] = await db
      .select({ value: count() })
      .from(posts)
      .leftJoin(responses, eq(posts.matchedResponseId, responses.id))
      .where(
        and(
          eq(posts.status, 'completed'),
          or(eq(posts.authorId, id), eq(responses.responderId, id)),
        ),
      )

    const recentReviews = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        reviewerName: user.name,
      })
      .from(reviews)
      .innerJoin(user, eq(reviews.reviewerId, user.id))
      .where(eq(reviews.revieweeId, id))
      .orderBy(desc(reviews.createdAt))
      .limit(10)

    return c.json({
      profile: {
        ...profile,
        reputation: {
          avgRating: reputation?.avgRating
            ? Number(reputation.avgRating)
            : null,
          reviewCount: reputation?.reviewCount ?? 0,
          completedCount: completed?.value ?? 0,
        },
        recentReviews,
      },
    })
  })
