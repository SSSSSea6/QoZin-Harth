import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '../db'
import { account, deviceCode, session, user } from '../db/auth-schema'
import {
  circles,
  comments,
  memberships,
  messages,
  posts,
  responses,
  reviews,
  toolDevSessions,
  tools,
  toolVersions,
} from '../db/schema'

export const DELETED_USER_NAME = '已注销用户'

export async function exportAccount(userId: string) {
  const [me] = await db
    .select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, userId))
  const sessions = await db
    .select({
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(eq(session.userId, userId))
  const joined = await db
    .select({ id: circles.id, name: circles.name, role: memberships.role, joinedAt: memberships.joinedAt })
    .from(memberships)
    .innerJoin(circles, eq(memberships.circleId, circles.id))
    .where(eq(memberships.userId, userId))
  const myPosts = await db
    .select({
      id: posts.id,
      circleId: posts.circleId,
      templateKey: posts.templateKey,
      title: posts.title,
      fields: posts.fields,
      status: posts.status,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.authorId, userId))
  const myComments = await db
    .select({ id: comments.id, postId: comments.postId, content: comments.content, createdAt: comments.createdAt })
    .from(comments)
    .where(eq(comments.authorId, userId))
  const myMessages = await db
    .select({ id: messages.id, circleId: messages.circleId, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.authorId, userId))
  const myResponses = await db
    .select({ id: responses.id, postId: responses.postId, message: responses.message, createdAt: responses.createdAt })
    .from(responses)
    .where(eq(responses.responderId, userId))
  const reviewsGiven = await db
    .select({ id: reviews.id, postId: reviews.postId, rating: reviews.rating, comment: reviews.comment, createdAt: reviews.createdAt })
    .from(reviews)
    .where(eq(reviews.reviewerId, userId))
  const reviewsReceived = await db
    .select({ id: reviews.id, postId: reviews.postId, rating: reviews.rating, comment: reviews.comment, createdAt: reviews.createdAt })
    .from(reviews)
    .where(eq(reviews.revieweeId, userId))
  const myTools = await db.select().from(tools).where(eq(tools.ownerId, userId))
  const toolList = []
  for (const tool of myTools) {
    const versions = await db
      .select({ version: toolVersions.version, status: toolVersions.status, createdAt: toolVersions.createdAt })
      .from(toolVersions)
      .where(eq(toolVersions.toolId, tool.id))
    toolList.push({ slug: tool.slug, name: tool.name, createdAt: tool.createdAt, versions })
  }

  return {
    exportedAt: new Date().toISOString(),
    user: me,
    sessions,
    circles: joined,
    posts: myPosts,
    comments: myComments,
    messages: myMessages,
    responses: myResponses,
    reviewsGiven,
    reviewsReceived,
    tools: toolList,
  }
}

// 个人信息删除，内容匿名保留；圈主交接给最早的成员，没人则归档；双人圈归档
export async function deleteAccount(userId: string): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    const mine = await tx
      .select({ circleId: memberships.circleId, role: memberships.role, isDm: circles.isDm })
      .from(memberships)
      .innerJoin(circles, eq(memberships.circleId, circles.id))
      .where(eq(memberships.userId, userId))

    const toArchive: string[] = []
    for (const m of mine) {
      if (m.isDm) {
        toArchive.push(m.circleId)
        continue
      }
      if (m.role !== 'owner') continue
      const [next] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.circleId, m.circleId), ne(memberships.userId, userId)))
        .orderBy(asc(memberships.joinedAt))
        .limit(1)
      if (next) {
        await tx
          .update(memberships)
          .set({ role: 'owner' })
          .where(and(eq(memberships.circleId, m.circleId), eq(memberships.userId, next.userId)))
      } else {
        toArchive.push(m.circleId)
      }
    }
    if (toArchive.length > 0) {
      await tx
        .update(circles)
        .set({ archivedAt: now, hibernationDeadline: null })
        .where(and(inArray(circles.id, toArchive), isNull(circles.archivedAt)))
    }

    await tx.delete(memberships).where(eq(memberships.userId, userId))
    await tx
      .update(posts)
      .set({ status: 'cancelled' })
      .where(and(eq(posts.authorId, userId), inArray(posts.status, ['open', 'matched'])))
    await tx.delete(toolDevSessions).where(eq(toolDevSessions.userId, userId))
    await tx.delete(deviceCode).where(eq(deviceCode.userId, userId))
    await tx.delete(session).where(eq(session.userId, userId))
    await tx.delete(account).where(eq(account.userId, userId))
    await tx
      .update(user)
      .set({
        name: DELETED_USER_NAME,
        email: `deleted-${userId}@invalid`,
        emailVerified: false,
        image: null,
      })
      .where(eq(user.id, userId))
  })
}
