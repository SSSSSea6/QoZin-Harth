import { and, eq, inArray, isNull } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { db } from '../db'
import { circleParents, circles, memberships } from '../db/schema'

export type CircleRow = typeof circles.$inferSelect
export type MembershipRow = typeof memberships.$inferSelect

export async function getCircle(id: string): Promise<CircleRow | null> {
  const rows = await db.select().from(circles).where(eq(circles.id, id)).limit(1)
  return rows[0] ?? null
}

export async function mustGetCircle(id: string): Promise<CircleRow> {
  const circle = await getCircle(id)
  if (!circle) throw new HTTPException(404, { message: '圈子不存在' })
  return circle
}

export async function getMembership(
  circleId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.circleId, circleId), eq(memberships.userId, userId)),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function mustGetMembership(
  circleId: string,
  userId: string,
): Promise<MembershipRow> {
  const membership = await getMembership(circleId, userId)
  if (!membership) throw new HTTPException(403, { message: '你不在这个圈子里' })
  return membership
}

export async function memberCircleIds(
  userId: string,
  circleIds: string[],
): Promise<Set<string>> {
  if (circleIds.length === 0) return new Set()
  const rows = await db
    .select({ circleId: memberships.circleId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        inArray(memberships.circleId, circleIds),
      ),
    )
  return new Set(rows.map((r) => r.circleId))
}

export async function parentIdsOf(circleId: string): Promise<string[]> {
  const rows = await db
    .select({ parentId: circleParents.parentId })
    .from(circleParents)
    .where(eq(circleParents.circleId, circleId))
  return rows.map((r) => r.parentId)
}

// 官方圈对所有人可见，公开圈对任一父圈的成员可见
export async function canSee(circle: CircleRow, userId: string): Promise<boolean> {
  if (await getMembership(circle.id, userId)) return true
  if (circle.visibility !== 'public' || circle.isDm) return false
  if (circle.isOfficial) return true
  const parents = await parentIdsOf(circle.id)
  const mine = await memberCircleIds(userId, parents)
  return mine.size > 0
}

// 有活动即刷新活跃时间并解除倒计时
export async function touchCircle(circleId: string, now = new Date()): Promise<void> {
  await db
    .update(circles)
    .set({ lastActivityAt: now, hibernationDeadline: null })
    .where(and(eq(circles.id, circleId), isNull(circles.archivedAt)))
}

export function assertNotArchived(circle: CircleRow): void {
  if (circle.archivedAt) {
    throw new HTTPException(409, { message: '圈子已归档，只读' })
  }
}
