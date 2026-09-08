import { and, desc, eq, exists, inArray, isNull, lt, lte, ne, notExists, or, sql, type SQL } from 'drizzle-orm'
import { fromDrizzle } from 'pg-boss'
import { db } from '../db'
import {
  circles,
  devices,
  memberships,
  NOTIFICATION_KINDS,
  notificationDeliveries,
  notifications,
  userBlocks,
} from '../db/schema'
import { getBoss, NOTIFY_QUEUE } from '../jobs/boss'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export type NotificationRow = typeof notifications.$inferSelect

export type NotifyEvent = {
  kind: NotificationKind
  eventKey: string
  circleId?: string | null
  actorId?: string | null
  refType: string
  refId: string
  title: string
  body: string
} & ({ recipients: string[] } | { circleMembersOf: string; exclude?: string[] })

const CIRCLE_KINDS: NotificationKind[] = ['dm', 'tool_post', 'circle_dying']
const NOTIFICATION_KEEP_DAYS = 90
const DELIVERY_KEEP_DAYS = 30
const DEVICE_IDLE_DAYS = 90

// 业务写入、通知行、投递任务在同一个事务里；未读的同一事件合并成一条，不再重复提醒
export async function notify(tx: Tx, event: NotifyEvent): Promise<{ created: number; merged: number }> {
  let recipients: string[]
  if ('recipients' in event) {
    recipients = [...new Set(event.recipients)]
  } else {
    const exclude = new Set(event.exclude ?? [])
    const rows = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.circleId, event.circleMembersOf))
    recipients = rows.map((r) => r.userId).filter((id) => !exclude.has(id))
  }
  if (recipients.length === 0) return { created: 0, merged: 0 }
  const now = new Date()
  const rows = await tx
    .insert(notifications)
    .values(
      recipients.map((userId) => ({
        userId,
        kind: event.kind,
        eventKey: event.eventKey,
        circleId: event.circleId ?? null,
        actorId: event.actorId ?? null,
        refType: event.refType,
        refId: event.refId,
        title: event.title,
        body: event.body,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [notifications.userId, notifications.eventKey],
      targetWhere: isNull(notifications.readAt),
      set: {
        count: sql`${notifications.count} + 1`,
        body: sql`excluded.body`,
        actorId: sql`excluded.actor_id`,
        updatedAt: now,
      },
    })
    .returning({ id: notifications.id, count: notifications.count })
  const fresh = rows.filter((r) => r.count === 1).map((r) => r.id)
  const boss = getBoss()
  if (boss && fresh.length > 0) {
    await boss.insert(
      NOTIFY_QUEUE,
      fresh.map((notificationId) => ({ data: { notificationId } })),
      { db: fromDrizzle(tx, sql) },
    )
  }
  return { created: fresh.length, merged: rows.length - fresh.length }
}

// 列表、未读数、投递都按当时的权限：退圈、屏蔽、圈子归档后相关通知不再给出
function visibleCondition(userId: string): SQL {
  const member = exists(
    db
      .select({ one: sql`1` })
      .from(memberships)
      .where(and(eq(memberships.circleId, notifications.circleId), eq(memberships.userId, userId))),
  )
  const liveCircle = exists(
    db
      .select({ one: sql`1` })
      .from(circles)
      .where(and(eq(circles.id, notifications.circleId), isNull(circles.archivedAt))),
  )
  const notBlocked = notExists(
    db
      .select({ one: sql`1` })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, notifications.actorId)),
          and(eq(userBlocks.blockedId, userId), eq(userBlocks.blockerId, notifications.actorId)),
        ),
      ),
  )
  return or(
    sql`${notifications.kind} NOT IN ('dm', 'tool_post', 'circle_dying')`,
    and(eq(notifications.kind, 'dm'), member, liveCircle, notBlocked),
    and(inArray(notifications.kind, ['tool_post', 'circle_dying']), member),
  )!
}

export async function listNotifications(userId: string, before?: string): Promise<NotificationRow[]> {
  const conditions = [eq(notifications.userId, userId), visibleCondition(userId)]
  if (before) {
    const [anchor] = await db.select({ createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.id, before)).limit(1)
    if (anchor) conditions.push(lt(notifications.createdAt, anchor.createdAt))
  }
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(30)
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), visibleCondition(userId)))
  return row?.value ?? 0
}

// 已读带上"看到哪一版"，刚合并进来的新消息不会被顺手标掉
export async function markRead(userId: string, input: { ids?: string[]; all?: boolean; seenUpdatedAt?: Date }): Promise<number> {
  const conditions = [eq(notifications.userId, userId), isNull(notifications.readAt)]
  if (!input.all) {
    if (!input.ids || input.ids.length === 0) return 0
    conditions.push(inArray(notifications.id, input.ids))
  }
  if (input.seenUpdatedAt) conditions.push(lte(notifications.updatedAt, input.seenUpdatedAt))
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(and(...conditions)).returning({ id: notifications.id })
  return rows.length
}

export async function stillAllowed(notification: NotificationRow): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.id, notification.id), visibleCondition(notification.userId)))
    .limit(1)
  return row !== undefined
}

export async function cleanupNotifications(now: Date): Promise<{ notifications: number; deliveries: number; devices: number }> {
  const day = 24 * 60 * 60 * 1000
  const gone = await db
    .delete(notifications)
    .where(lt(notifications.updatedAt, new Date(now.getTime() - NOTIFICATION_KEEP_DAYS * day)))
    .returning({ id: notifications.id })
  const deliveries = await db
    .delete(notificationDeliveries)
    .where(lt(notificationDeliveries.updatedAt, new Date(now.getTime() - DELIVERY_KEEP_DAYS * day)))
    .returning({ id: notificationDeliveries.notificationId })
  const idle = await db
    .update(devices)
    .set({ disabledAt: now })
    .where(and(isNull(devices.disabledAt), lt(devices.lastSeenAt, new Date(now.getTime() - DEVICE_IDLE_DAYS * day))))
    .returning({ id: devices.id })
  return { notifications: gone.length, deliveries: deliveries.length, devices: idle.length }
}

export const NOTIFICATION_TEXT: Record<NotificationKind, string> = {
  dm: '新私聊消息',
  tool_post: '圈里的工具发了新帖',
  circle_dying: '圈子快熄了',
  application: '开发者申请有结果了',
  report: '你的举报处理了',
  moderation: '你的内容或账号被处理',
  appeal: '你的申诉有结果了',
}

export { ne }
