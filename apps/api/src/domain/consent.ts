import type { ToolScope } from '@harth/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { circles, toolConsents, tools } from '../db/schema'

// 权限集合只按内容比较，顺序无关；缺任何一项都要重新问
export function covers(consented: string[], required: string[]): boolean {
  const have = new Set(consented)
  return required.every((scope) => have.has(scope))
}

export async function hasConsent(userId: string, toolId: string, circleId: string, scopes: ToolScope[]): Promise<boolean> {
  const [row] = await db
    .select({ scopes: toolConsents.scopes, revokedAt: toolConsents.revokedAt })
    .from(toolConsents)
    .where(and(eq(toolConsents.userId, userId), eq(toolConsents.toolId, toolId), eq(toolConsents.circleId, circleId)))
    .limit(1)
  return row !== undefined && row.revokedAt === null && covers(row.scopes, scopes)
}

export async function grantConsent(userId: string, toolId: string, circleId: string, scopes: ToolScope[]): Promise<void> {
  const sorted = [...new Set(scopes)].sort()
  await db
    .insert(toolConsents)
    .values({ userId, toolId, circleId, scopes: sorted })
    .onConflictDoUpdate({
      target: [toolConsents.userId, toolConsents.toolId, toolConsents.circleId],
      set: { scopes: sorted, consentedAt: new Date(), revokedAt: null },
    })
}

export async function revokeConsent(userId: string, toolId: string, circleId: string): Promise<void> {
  await db
    .update(toolConsents)
    .set({ revokedAt: new Date() })
    .where(and(eq(toolConsents.userId, userId), eq(toolConsents.toolId, toolId), eq(toolConsents.circleId, circleId), isNull(toolConsents.revokedAt)))
}

export async function listConsents(userId: string) {
  return db
    .select({
      toolId: toolConsents.toolId,
      circleId: toolConsents.circleId,
      scopes: toolConsents.scopes,
      consentedAt: toolConsents.consentedAt,
      toolSlug: tools.slug,
      toolName: tools.name,
      circleName: circles.name,
    })
    .from(toolConsents)
    .innerJoin(tools, eq(tools.id, toolConsents.toolId))
    .innerJoin(circles, eq(circles.id, toolConsents.circleId))
    .where(and(eq(toolConsents.userId, userId), isNull(toolConsents.revokedAt)))
    .orderBy(toolConsents.consentedAt)
}

// 工具读成员数据时的范围：只有仍然同意的成员
export async function consentedUserIds(toolId: string, circleId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: toolConsents.userId })
    .from(toolConsents)
    .where(and(eq(toolConsents.toolId, toolId), eq(toolConsents.circleId, circleId), isNull(toolConsents.revokedAt)))
  return new Set(rows.map((r) => r.userId))
}
