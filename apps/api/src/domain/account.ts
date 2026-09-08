import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { db } from '../db'
import { account, deviceCode, session, user } from '../db/auth-schema'
import {
  appeals,
  circleNotify,
  circles,
  comments,
  developerApplications,
  developers,
  devices,
  fuelAccounts,
  memberships,
  messages,
  moderations,
  notifications,
  posts,
  reports,
  responses,
  reviews,
  smsSends,
  toolConsents,
  toolDevSessions,
  tools,
  toolUsage,
  toolVersions,
  userBlocks,
  userRestrictions,
} from '../db/schema'
import { closeDeveloperOnDeletion, myInvites } from './developers'

export const DELETED_USER_NAME = '已注销用户'

export async function exportAccount(userId: string) {
  const [me] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
      createdAt: user.createdAt,
    })
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
  const [developer] = await db
    .select({ source: developers.source, grantedAt: developers.grantedAt, revokedAt: developers.revokedAt, revokeReason: developers.revokeReason })
    .from(developers)
    .where(eq(developers.userId, userId))
  const applications = await db
    .select({
      id: developerApplications.id,
      message: developerApplications.message,
      status: developerApplications.status,
      note: developerApplications.note,
      createdAt: developerApplications.createdAt,
      decidedAt: developerApplications.decidedAt,
    })
    .from(developerApplications)
    .where(eq(developerApplications.userId, userId))
  const invites = await myInvites(userId)
  const fuel = await db
    .select({ month: fuelAccounts.month, used: fuelAccounts.used, storageBytes: fuelAccounts.storageBytes })
    .from(fuelAccounts)
    .where(eq(fuelAccounts.ownerId, userId))
  const usage = await db.select().from(toolUsage).where(eq(toolUsage.ownerId, userId))
  const blocks = await db
    .select({ blockedId: userBlocks.blockedId, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, userId))
  // 举报只导出自己提交的；被举报的记录属于举报人，不给
  const reportsFiled = await db
    .select({
      id: reports.id,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      detail: reports.detail,
      status: reports.status,
      createdAt: reports.createdAt,
      handledAt: reports.handledAt,
    })
    .from(reports)
    .where(eq(reports.reporterId, userId))
  const moderationsAgainstMe = await db
    .select({
      id: moderations.id,
      action: moderations.action,
      targetType: moderations.targetType,
      targetId: moderations.targetId,
      reason: moderations.reason,
      until: moderations.until,
      reversalOf: moderations.reversalOf,
      createdAt: moderations.createdAt,
    })
    .from(moderations)
    .where(eq(moderations.subjectUserId, userId))
  const myAppeals = await db
    .select({
      id: appeals.id,
      moderationId: appeals.moderationId,
      text: appeals.text,
      status: appeals.status,
      note: appeals.note,
      createdAt: appeals.createdAt,
      decidedAt: appeals.decidedAt,
    })
    .from(appeals)
    .where(eq(appeals.userId, userId))
  const consents = await db
    .select({ toolId: toolConsents.toolId, circleId: toolConsents.circleId, scopes: toolConsents.scopes, consentedAt: toolConsents.consentedAt, revokedAt: toolConsents.revokedAt })
    .from(toolConsents)
    .where(eq(toolConsents.userId, userId))
  const myNotifications = await db
    .select({ id: notifications.id, kind: notifications.kind, title: notifications.title, body: notifications.body, createdAt: notifications.createdAt, readAt: notifications.readAt })
    .from(notifications)
    .where(eq(notifications.userId, userId))
  const myDevices = await db
    .select({ id: devices.id, platform: devices.platform, appVersion: devices.appVersion, boundAt: devices.boundAt, lastSeenAt: devices.lastSeenAt, disabledAt: devices.disabledAt })
    .from(devices)
    .where(eq(devices.userId, userId))
  const [restriction] = await db
    .select({ kind: userRestrictions.kind, until: userRestrictions.until, reason: userRestrictions.reason, createdAt: userRestrictions.createdAt })
    .from(userRestrictions)
    .where(eq(userRestrictions.userId, userId))

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
    developer: developer ?? null,
    applications,
    invites,
    fuel,
    usage,
    blocks,
    reports: reportsFiled,
    moderations: moderationsAgainstMe,
    appeals: myAppeals,
    restriction: restriction ?? null,
    consents,
    notifications: myNotifications,
    devices: myDevices,
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
    await closeDeveloperOnDeletion(tx, userId)
    await tx.delete(toolDevSessions).where(eq(toolDevSessions.userId, userId))
    await tx.delete(deviceCode).where(eq(deviceCode.userId, userId))
    await tx.delete(session).where(eq(session.userId, userId))
    await tx.delete(account).where(eq(account.userId, userId))
    // 屏蔽关系与发码记录随人删除；举报与处置记录保留作审核依据，人已匿名
    await tx.delete(userBlocks).where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)))
    await tx.delete(smsSends).where(eq(smsSends.userId, userId))
    await tx.delete(toolConsents).where(eq(toolConsents.userId, userId))
    await tx.delete(notifications).where(eq(notifications.userId, userId))
    await tx.delete(devices).where(eq(devices.userId, userId))
    await tx.delete(circleNotify).where(eq(circleNotify.userId, userId))
    await tx
      .update(user)
      .set({
        name: DELETED_USER_NAME,
        email: `deleted-${userId}@invalid`,
        emailVerified: false,
        image: null,
        phoneNumber: null,
        phoneNumberVerified: null,
      })
      .where(eq(user.id, userId))
  })
}
