import type { ReportTargetType } from '@harth/shared'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { user } from '../db/auth-schema'
import {
  appeals,
  bannedPhones,
  circles,
  comments,
  messages,
  moderations,
  posts,
  reports,
  responses,
  reviews,
  tools,
  userRestrictions,
} from '../db/schema'
import { fail } from '../http'
import { canSee, getCircle, getMembership } from './circles'
import { phoneFingerprint } from './phone'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx
type ModerationRow = typeof moderations.$inferSelect
type ReportRow = typeof reports.$inferSelect

export interface Target {
  type: ReportTargetType
  id: string
  subjectUserId: string | null
  circleId: string | null
  snapshot: string
  text: string
}

const CONTENT_TABLES = {
  post: posts,
  comment: comments,
  response: responses,
  review: reviews,
  message: messages,
} as const

type ContentType = keyof typeof CONTENT_TABLES

function isContent(type: ReportTargetType): type is ContentType {
  return type in CONTENT_TABLES
}

// 举报、处置都先把目标解析成同一个形状；目标不存在就是 404
export async function resolveTarget(x: Executor, type: ReportTargetType, id: string): Promise<Target | null> {
  switch (type) {
    case 'post': {
      const [row] = await x.select().from(posts).where(eq(posts.id, id)).limit(1)
      if (!row) return null
      const body = typeof row.fields.body === 'string' ? row.fields.body : typeof row.fields.description === 'string' ? row.fields.description : ''
      return { type, id, subjectUserId: row.authorId, circleId: row.circleId, snapshot: row.title, text: `${row.title}\n${body}` }
    }
    case 'comment': {
      const [row] = await x
        .select({ authorId: comments.authorId, content: comments.content, circleId: posts.circleId })
        .from(comments)
        .innerJoin(posts, eq(posts.id, comments.postId))
        .where(eq(comments.id, id))
        .limit(1)
      return row ? { type, id, subjectUserId: row.authorId, circleId: row.circleId, snapshot: row.content, text: row.content } : null
    }
    case 'response': {
      const [row] = await x
        .select({ responderId: responses.responderId, message: responses.message, circleId: posts.circleId })
        .from(responses)
        .innerJoin(posts, eq(posts.id, responses.postId))
        .where(eq(responses.id, id))
        .limit(1)
      return row ? { type, id, subjectUserId: row.responderId, circleId: row.circleId, snapshot: row.message, text: row.message } : null
    }
    case 'review': {
      const [row] = await x
        .select({ reviewerId: reviews.reviewerId, comment: reviews.comment, circleId: posts.circleId })
        .from(reviews)
        .innerJoin(posts, eq(posts.id, reviews.postId))
        .where(eq(reviews.id, id))
        .limit(1)
      return row ? { type, id, subjectUserId: row.reviewerId, circleId: row.circleId, snapshot: row.comment ?? '', text: row.comment ?? '' } : null
    }
    case 'message': {
      const [row] = await x.select().from(messages).where(eq(messages.id, id)).limit(1)
      return row ? { type, id, subjectUserId: row.authorId, circleId: row.circleId, snapshot: row.content, text: row.content } : null
    }
    case 'user': {
      const [row] = await x.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, id)).limit(1)
      return row ? { type, id, subjectUserId: row.id, circleId: null, snapshot: row.name, text: row.name } : null
    }
    case 'tool': {
      const [row] = await x.select({ id: tools.id, name: tools.name, ownerId: tools.ownerId }).from(tools).where(eq(tools.id, id)).limit(1)
      return row ? { type, id, subjectUserId: row.ownerId, circleId: null, snapshot: row.name, text: row.name } : null
    }
    case 'circle': {
      const [row] = await x.select({ id: circles.id, name: circles.name, createdBy: circles.createdBy }).from(circles).where(eq(circles.id, id)).limit(1)
      return row ? { type, id, subjectUserId: row.createdBy, circleId: row.id, snapshot: row.name, text: row.name } : null
    }
  }
}

// 举报人得先能看到目标：圈内内容要是成员，圈子要可见，用户与工具公开
async function reporterCanSee(target: Target, reporterId: string): Promise<boolean> {
  if (target.type === 'user' || target.type === 'tool') return true
  if (target.type === 'circle') {
    const circle = await getCircle(target.id)
    return circle ? canSee(circle, reporterId) : false
  }
  return target.circleId ? (await getMembership(target.circleId, reporterId)) !== null : false
}

export async function createReport(
  reporterId: string,
  input: { targetType: ReportTargetType; targetId: string; reason: ReportRow['reason']; detail?: string },
): Promise<{ id: string }> {
  const target = await resolveTarget(db, input.targetType, input.targetId)
  if (!target || !(await reporterCanSee(target, reporterId))) throw fail(404, 'NOT_FOUND', '举报对象不存在')
  if (target.subjectUserId === reporterId) throw fail(400, 'BAD_REQUEST', '不能举报自己')
  const [row] = await db
    .insert(reports)
    .values({
      reporterId,
      targetType: target.type,
      targetId: target.id,
      reason: input.reason,
      detail: input.detail || null,
      snapshot: target.snapshot.slice(0, 200),
    })
    .onConflictDoNothing()
    .returning({ id: reports.id })
  if (!row) throw fail(409, 'CONFLICT', '你已经举报过，等待处理')
  return row
}

export async function myReports(userId: string) {
  return db
    .select({
      id: reports.id,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      status: reports.status,
      createdAt: reports.createdAt,
      handledAt: reports.handledAt,
    })
    .from(reports)
    .where(eq(reports.reporterId, userId))
    .orderBy(desc(reports.createdAt))
    .limit(50)
}

export async function listReports(status: ReportRow['status']) {
  const reporter = user
  return db
    .select({
      id: reports.id,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      detail: reports.detail,
      snapshot: reports.snapshot,
      status: reports.status,
      createdAt: reports.createdAt,
      handledAt: reports.handledAt,
      moderationId: reports.moderationId,
      reporterName: reporter.name,
    })
    .from(reports)
    .leftJoin(reporter, eq(reports.reporterId, reporter.id))
    .where(eq(reports.status, status))
    .orderBy(status === 'pending' ? reports.createdAt : desc(reports.handledAt))
    .limit(100)
}

type Effect = {
  action: ModerationRow['action']
  target: Target
  reason: string
  until: Date | null
  by: string
  reportId: string | null
  reversalOf: string | null
}

// 一条处置 = 一条审计记录 + 它的效果，都在同一个事务里
async function applyModeration(tx: Tx, effect: Effect): Promise<ModerationRow> {
  const [row] = await tx
    .insert(moderations)
    .values({
      action: effect.action,
      targetType: effect.target.type,
      targetId: effect.target.id,
      subjectUserId: effect.target.subjectUserId,
      reportId: effect.reportId,
      reason: effect.reason,
      until: effect.until,
      by: effect.by,
      reversalOf: effect.reversalOf,
    })
    .returning()
  const moderation = row!
  switch (effect.action) {
    case 'hide': {
      if (!isContent(effect.target.type)) throw fail(400, 'BAD_REQUEST', '只有内容能隐藏')
      const table = CONTENT_TABLES[effect.target.type]
      await tx.update(table).set({ hiddenAt: moderation.createdAt, hiddenModerationId: moderation.id }).where(eq(table.id, effect.target.id))
      break
    }
    case 'restore': {
      if (!isContent(effect.target.type)) throw fail(400, 'BAD_REQUEST', '只有内容能恢复')
      const table = CONTENT_TABLES[effect.target.type]
      await tx
        .update(table)
        .set({ hiddenAt: null, hiddenModerationId: null })
        .where(and(eq(table.id, effect.target.id), eq(table.hiddenModerationId, effect.reversalOf ?? '')))
      break
    }
    case 'mute':
    case 'ban': {
      const subject = effect.target.subjectUserId
      if (!subject) throw fail(400, 'BAD_REQUEST', '这个对象没有可处置的账号')
      await tx
        .insert(userRestrictions)
        .values({ userId: subject, kind: effect.action, until: effect.until, reason: effect.reason, moderationId: moderation.id })
        .onConflictDoUpdate({
          target: userRestrictions.userId,
          set: { kind: effect.action, until: effect.until, reason: effect.reason, moderationId: moderation.id, createdAt: moderation.createdAt },
          // 封禁盖过禁言；已封禁的不会被后来的禁言降级
          setWhere: sql`${userRestrictions.kind} <> 'ban' OR ${sql.raw(`'${effect.action}'`)} = 'ban'`,
        })
      if (effect.action === 'ban') {
        const [subjectUser] = await tx.select({ phone: user.phoneNumber }).from(user).where(eq(user.id, subject)).limit(1)
        if (subjectUser?.phone) {
          await tx
            .insert(bannedPhones)
            .values({ phoneHmac: phoneFingerprint(subjectUser.phone), moderationId: moderation.id, until: effect.until })
            .onConflictDoUpdate({ target: bannedPhones.phoneHmac, set: { moderationId: moderation.id, until: effect.until } })
        }
      }
      break
    }
    case 'unmute':
    case 'unban': {
      const subject = effect.target.subjectUserId
      if (!subject) break
      await tx
        .delete(userRestrictions)
        .where(and(eq(userRestrictions.userId, subject), eq(userRestrictions.moderationId, effect.reversalOf ?? '')))
      await tx.delete(bannedPhones).where(eq(bannedPhones.moderationId, effect.reversalOf ?? ''))
      break
    }
    case 'tool_suspend':
      await tx.update(tools).set({ suspendedAt: moderation.createdAt }).where(eq(tools.id, effect.target.id))
      break
    case 'tool_restore':
      await tx.update(tools).set({ suspendedAt: null }).where(eq(tools.id, effect.target.id))
      break
  }
  return moderation
}

const REVERSAL: Partial<Record<ModerationRow['action'], ModerationRow['action']>> = {
  hide: 'restore',
  mute: 'unmute',
  ban: 'unban',
  tool_suspend: 'tool_restore',
}

export async function decideReport(
  adminId: string,
  reportId: string,
  decision: { action: 'hide' | 'mute' | 'ban' | 'tool_suspend' | 'dismiss'; reason: string; days?: 1 | 7 | 30 },
): Promise<{ moderationId: string | null }> {
  return db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).limit(1)
    if (!report) throw fail(404, 'NOT_FOUND', '举报不存在')
    const target = await resolveTarget(tx, report.targetType, report.targetId)
    let moderationId: string | null = null
    if (decision.action !== 'dismiss') {
      if (!target) throw fail(409, 'CONFLICT', '举报对象已不存在，只能驳回')
      if (target.subjectUserId === adminId) throw fail(400, 'BAD_REQUEST', '不能处置自己')
      const action = decision.action
      if (action === 'tool_suspend' && target.type !== 'tool') throw fail(400, 'BAD_REQUEST', '只有工具能停用')
      if (action === 'hide' && !isContent(target.type)) throw fail(400, 'BAD_REQUEST', '只有内容能隐藏')
      if (action === 'mute' && !decision.days) throw fail(400, 'BAD_REQUEST', '禁言要选天数')
      const until = action === 'mute' ? new Date(Date.now() + decision.days! * 24 * 60 * 60 * 1000) : null
      const moderation = await applyModeration(tx, { action, target, reason: decision.reason, until, by: adminId, reportId: report.id, reversalOf: null })
      moderationId = moderation.id
    }
    const [updated] = await tx
      .update(reports)
      .set({ status: decision.action === 'dismiss' ? 'dismissed' : 'handled', handledBy: adminId, handledAt: new Date(), moderationId })
      .where(and(eq(reports.id, reportId), eq(reports.status, 'pending')))
      .returning({ id: reports.id })
    if (!updated) throw fail(409, 'CONFLICT', '这条举报已经处理过了')
    return { moderationId }
  })
}

export async function reverseModeration(adminId: string, moderationId: string, reason: string): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(moderations).where(eq(moderations.id, moderationId)).limit(1)
    if (!original) throw fail(404, 'NOT_FOUND', '处置记录不存在')
    const action = REVERSAL[original.action]
    if (!action) throw fail(400, 'BAD_REQUEST', '这条记录本身就是撤销')
    const [already] = await tx.select({ id: moderations.id }).from(moderations).where(eq(moderations.reversalOf, moderationId)).limit(1)
    if (already) throw fail(409, 'CONFLICT', '已经撤销过了')
    const target = (await resolveTarget(tx, original.targetType, original.targetId)) ?? {
      type: original.targetType,
      id: original.targetId,
      subjectUserId: original.subjectUserId,
      circleId: null,
      snapshot: '',
      text: '',
    }
    const moderation = await applyModeration(tx, { action, target, reason, until: null, by: adminId, reportId: original.reportId, reversalOf: original.id })
    return { id: moderation.id }
  })
}

export async function listModerations() {
  const admin = user
  return db
    .select({
      id: moderations.id,
      action: moderations.action,
      targetType: moderations.targetType,
      targetId: moderations.targetId,
      subjectUserId: moderations.subjectUserId,
      reason: moderations.reason,
      until: moderations.until,
      reversalOf: moderations.reversalOf,
      createdAt: moderations.createdAt,
      byName: admin.name,
    })
    .from(moderations)
    .innerJoin(admin, eq(moderations.by, admin.id))
    .orderBy(desc(moderations.createdAt))
    .limit(100)
}

// 管理员看证据：只有被举报的那一条与它的作者，不给整段私聊
export async function evidence(reportId: string) {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
  if (!report) throw fail(404, 'NOT_FOUND', '举报不存在')
  const target = await resolveTarget(db, report.targetType, report.targetId)
  return { report, target: target ? { type: target.type, id: target.id, subjectUserId: target.subjectUserId, text: target.text } : null }
}

export async function myModerations(userId: string) {
  const appeal = appeals
  return db
    .select({
      id: moderations.id,
      action: moderations.action,
      targetType: moderations.targetType,
      targetId: moderations.targetId,
      reason: moderations.reason,
      until: moderations.until,
      createdAt: moderations.createdAt,
      reversed: sql<boolean>`exists (select 1 from ${moderations} as r where r.reversal_of = ${moderations.id})`,
      appealStatus: appeal.status,
      appealNote: appeal.note,
    })
    .from(moderations)
    .leftJoin(appeal, eq(appeal.moderationId, moderations.id))
    .where(and(eq(moderations.subjectUserId, userId), isNull(moderations.reversalOf)))
    .orderBy(desc(moderations.createdAt))
    .limit(50)
}

export async function createAppeal(userId: string, moderationId: string, text: string): Promise<{ id: string }> {
  const [moderation] = await db.select().from(moderations).where(eq(moderations.id, moderationId)).limit(1)
  if (!moderation || moderation.subjectUserId !== userId) throw fail(404, 'NOT_FOUND', '处置记录不存在')
  if (moderation.reversalOf) throw fail(400, 'BAD_REQUEST', '撤销记录不用申诉')
  const [row] = await db.insert(appeals).values({ moderationId, userId, text }).onConflictDoNothing().returning({ id: appeals.id })
  if (!row) throw fail(409, 'CONFLICT', '这条处置已经申诉过')
  return row
}

export async function listAppeals(status: 'pending' | 'accepted' | 'rejected') {
  const subject = user
  return db
    .select({
      id: appeals.id,
      moderationId: appeals.moderationId,
      text: appeals.text,
      status: appeals.status,
      note: appeals.note,
      createdAt: appeals.createdAt,
      decidedAt: appeals.decidedAt,
      userId: appeals.userId,
      userName: subject.name,
      action: moderations.action,
      targetType: moderations.targetType,
      targetId: moderations.targetId,
      reason: moderations.reason,
    })
    .from(appeals)
    .innerJoin(moderations, eq(moderations.id, appeals.moderationId))
    .innerJoin(subject, eq(appeals.userId, subject.id))
    .where(eq(appeals.status, status))
    .orderBy(status === 'pending' ? appeals.createdAt : desc(appeals.decidedAt))
    .limit(100)
}

// 接受申诉只撤销被申诉的那一条，之后的处罚不受影响
export async function decideAppeal(adminId: string, appealId: string, accept: boolean, note: string): Promise<void> {
  const [appeal] = await db.select().from(appeals).where(eq(appeals.id, appealId)).limit(1)
  if (!appeal) throw fail(404, 'NOT_FOUND', '申诉不存在')
  if (appeal.status !== 'pending') throw fail(409, 'CONFLICT', '这条申诉已经处理过了')
  if (accept) {
    const [already] = await db.select({ id: moderations.id }).from(moderations).where(eq(moderations.reversalOf, appeal.moderationId)).limit(1)
    if (!already) await reverseModeration(adminId, appeal.moderationId, `申诉通过：${note}`)
  }
  const [updated] = await db
    .update(appeals)
    .set({ status: accept ? 'accepted' : 'rejected', decidedBy: adminId, decidedAt: new Date(), note })
    .where(and(eq(appeals.id, appealId), eq(appeals.status, 'pending')))
    .returning({ id: appeals.id })
  if (!updated) throw fail(409, 'CONFLICT', '这条申诉已经处理过了')
}

// 巡查：最近的公开内容（帖子与回复），私聊只在被举报后可见
export async function recentContent(limit = 50) {
  const author = user
  const recentPosts = await db
    .select({ id: posts.id, circleId: posts.circleId, title: posts.title, authorId: posts.authorId, authorName: author.name, createdAt: posts.createdAt, hiddenAt: posts.hiddenAt })
    .from(posts)
    .leftJoin(author, eq(posts.authorId, author.id))
    .orderBy(desc(posts.createdAt))
    .limit(limit)
  const recentComments = await db
    .select({ id: comments.id, postId: comments.postId, content: comments.content, authorId: comments.authorId, authorName: author.name, createdAt: comments.createdAt, hiddenAt: comments.hiddenAt })
    .from(comments)
    .innerJoin(author, eq(comments.authorId, author.id))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
  return { posts: recentPosts, comments: recentComments }
}

export async function isPhoneBanned(phone: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ until: bannedPhones.until })
    .from(bannedPhones)
    .where(eq(bannedPhones.phoneHmac, phoneFingerprint(phone)))
    .limit(1)
  return row !== undefined && (row.until === null || row.until > now)
}

export async function hiddenReasonOf(moderationId: string): Promise<string | null> {
  const [row] = await db.select({ reason: moderations.reason }).from(moderations).where(eq(moderations.id, moderationId)).limit(1)
  return row?.reason ?? null
}

// 巡查里直接处置，不经举报
export async function moderateDirect(
  adminId: string,
  input: { targetType: ReportTargetType; targetId: string; action: 'hide' | 'mute' | 'ban' | 'tool_suspend'; reason: string; days?: 1 | 7 | 30 },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const target = await resolveTarget(tx, input.targetType, input.targetId)
    if (!target) throw fail(404, 'NOT_FOUND', '对象不存在')
    if (target.subjectUserId === adminId) throw fail(400, 'BAD_REQUEST', '不能处置自己')
    if (input.action === 'mute' && !input.days) throw fail(400, 'BAD_REQUEST', '禁言要选天数')
    const until = input.action === 'mute' ? new Date(Date.now() + input.days! * 24 * 60 * 60 * 1000) : null
    const moderation = await applyModeration(tx, { action: input.action, target, reason: input.reason, until, by: adminId, reportId: null, reversalOf: null })
    return { id: moderation.id }
  })
}
