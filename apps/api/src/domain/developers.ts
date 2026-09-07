import { randomInt } from 'node:crypto'
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_VALID_DAYS,
  INVITES_PER_DEVELOPER,
} from '@harth/shared'
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { developerApplications, developerInvites, developers } from '../db/schema'
import type { Executor } from '../tools/fuel'

export type DeveloperRow = typeof developers.$inferSelect
export type ApplicationRow = typeof developerApplications.$inferSelect
export type DeveloperStatus = 'none' | 'active' | 'revoked'

const ADMIN_LIST_LIMIT = 50

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } } | null)?.code
    ?? (err as { cause?: { code?: string } } | null)?.cause?.code
  return code === '23505'
}

export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]
  }
  return code
}

export async function developerOf(x: Executor, userId: string): Promise<DeveloperRow | null> {
  const rows = await x.select().from(developers).where(eq(developers.userId, userId)).limit(1)
  return rows[0] ?? null
}

export function statusOf(row: DeveloperRow | null): DeveloperStatus {
  if (!row) return 'none'
  return row.revokedAt ? 'revoked' : 'active'
}

export async function requireDeveloper(userId: string): Promise<void> {
  const row = await developerOf(db, userId)
  if (row && !row.revokedAt) return
  throw new HTTPException(403, {
    message: row
      ? '开发者资格已被撤销，需要管理员恢复'
      : '发布工具需要开发者资格：用邀请码兑换，或在开发者页申请',
  })
}

// 发码：碰撞就换一个再试
export async function createInvites(
  x: Executor,
  input: { ownerId: string | null; createdBy: string; count: number },
): Promise<string[]> {
  const codes: string[] = []
  const expiresAt = new Date(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000)
  while (codes.length < input.count) {
    const rows = await x
      .insert(developerInvites)
      .values({ code: generateInviteCode(), ownerId: input.ownerId, createdBy: input.createdBy, expiresAt })
      .onConflictDoNothing()
      .returning({ code: developerInvites.code })
    if (rows[0]) codes.push(rows[0].code)
  }
  return codes
}

// 授予资格并发首批邀请码；已有资格的原样返回，被撤销的不能靠授予自动恢复
async function grant(
  x: Executor,
  input: { userId: string; source: DeveloperRow['source']; sourceRef: string | null; grantedBy: string | null },
): Promise<{ status: 'granted' | 'exists' | 'revoked'; codes: string[] }> {
  const existing = await developerOf(x, input.userId)
  if (existing) return { status: existing.revokedAt ? 'revoked' : 'exists', codes: [] }
  await x.insert(developers).values(input)
  const codes = await createInvites(x, { ownerId: input.userId, createdBy: input.userId, count: INVITES_PER_DEVELOPER })
  return { status: 'granted', codes }
}

export async function redeemInvite(userId: string, code: string): Promise<{ codes: string[] }> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await developerOf(tx, userId)
      if (existing?.revokedAt) throw new HTTPException(403, { message: '开发者资格已被撤销，需要管理员恢复' })
      if (existing) throw new HTTPException(409, { message: '你已经是开发者了' })
      const now = new Date()
      const [claimed] = await tx
        .update(developerInvites)
        .set({ usedBy: userId, usedAt: now })
        .where(
          and(
            eq(developerInvites.code, code),
            isNull(developerInvites.usedBy),
            isNull(developerInvites.revokedAt),
            gt(developerInvites.expiresAt, now),
            sql`NOT EXISTS (SELECT 1 FROM ${developers} WHERE ${developers.userId} = ${developerInvites.ownerId} AND ${developers.revokedAt} IS NOT NULL)`,
          ),
        )
        .returning({ code: developerInvites.code, ownerId: developerInvites.ownerId, createdBy: developerInvites.createdBy })
      if (!claimed) throw new HTTPException(404, { message: '邀请码无效、已被用过或已过期' })
      const result = await grant(tx, {
        userId,
        source: 'invite',
        sourceRef: claimed.code,
        grantedBy: claimed.ownerId ?? claimed.createdBy,
      })
      return { codes: result.codes }
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new HTTPException(409, { message: '你已经是开发者了' })
    throw err
  }
}

export async function applyForDeveloper(userId: string, message: string): Promise<ApplicationRow> {
  const existing = await developerOf(db, userId)
  if (existing?.revokedAt) throw new HTTPException(403, { message: '开发者资格已被撤销，需要管理员恢复' })
  if (existing) throw new HTTPException(409, { message: '你已经是开发者了' })
  try {
    const [row] = await db.insert(developerApplications).values({ userId, message }).returning()
    return row!
  } catch (err) {
    if (isUniqueViolation(err)) throw new HTTPException(409, { message: '已有一条申请在处理中' })
    throw err
  }
}

export async function decideApplication(
  adminId: string,
  id: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<{ application: ApplicationRow; codes: string[] }> {
  const trimmed = note?.trim() || null
  if (decision === 'reject' && !trimmed) throw new HTTPException(400, { message: '驳回要写原因' })
  return db.transaction(async (tx) => {
    const [application] = await tx
      .update(developerApplications)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
        note: trimmed,
        decidedAt: new Date(),
        decidedBy: adminId,
      })
      .where(and(eq(developerApplications.id, id), eq(developerApplications.status, 'pending')))
      .returning()
    if (!application) throw new HTTPException(409, { message: '这条申请已经处理过了' })
    if (decision === 'reject') return { application, codes: [] }
    const result = await grant(tx, {
      userId: application.userId,
      source: 'application',
      sourceRef: application.id,
      grantedBy: adminId,
    })
    if (result.status === 'revoked') {
      throw new HTTPException(409, { message: '这个用户的资格已被撤销，先恢复再处理申请' })
    }
    return { application, codes: result.codes }
  })
}

export async function revokeDeveloper(adminId: string, userId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(developers)
      .set({ revokedAt: now, revokedBy: adminId, revokeReason: reason })
      .where(and(eq(developers.userId, userId), isNull(developers.revokedAt)))
      .returning({ userId: developers.userId })
    if (!row) throw new HTTPException(404, { message: '这个用户没有有效的开发者资格' })
    await tx
      .update(developerInvites)
      .set({ revokedAt: now })
      .where(and(eq(developerInvites.ownerId, userId), isNull(developerInvites.usedBy), isNull(developerInvites.revokedAt)))
  })
}

export async function restoreDeveloper(userId: string): Promise<void> {
  const [row] = await db
    .update(developers)
    .set({ revokedAt: null, revokedBy: null, revokeReason: null })
    .where(and(eq(developers.userId, userId), isNotNull(developers.revokedAt)))
    .returning({ userId: developers.userId })
  if (!row) throw new HTTPException(404, { message: '这个用户没有被撤销的资格' })
}

// 注销账号时：资格作废、未用的码作废、待处理的申请关闭、申请内容清空
export async function closeDeveloperOnDeletion(x: Executor, userId: string): Promise<void> {
  const now = new Date()
  await x
    .update(developers)
    .set({ revokedAt: now, revokeReason: '账号注销' })
    .where(and(eq(developers.userId, userId), isNull(developers.revokedAt)))
  await x
    .update(developerInvites)
    .set({ revokedAt: now })
    .where(and(eq(developerInvites.ownerId, userId), isNull(developerInvites.usedBy), isNull(developerInvites.revokedAt)))
  await x
    .update(developerApplications)
    .set({ status: 'rejected', note: '账号已注销', decidedAt: now })
    .where(and(eq(developerApplications.userId, userId), eq(developerApplications.status, 'pending')))
  await x.update(developerApplications).set({ message: '' }).where(eq(developerApplications.userId, userId))
}

export async function myInvites(userId: string) {
  return db
    .select({
      code: developerInvites.code,
      usedBy: user.name,
      usedAt: developerInvites.usedAt,
      expiresAt: developerInvites.expiresAt,
      revokedAt: developerInvites.revokedAt,
    })
    .from(developerInvites)
    .leftJoin(user, eq(developerInvites.usedBy, user.id))
    .where(eq(developerInvites.ownerId, userId))
    .orderBy(desc(developerInvites.createdAt))
}

export async function latestApplication(userId: string): Promise<ApplicationRow | null> {
  const rows = await db
    .select()
    .from(developerApplications)
    .where(eq(developerApplications.userId, userId))
    .orderBy(desc(developerApplications.createdAt))
    .limit(1)
  return rows[0] ?? null
}

export async function listApplications(status: 'pending' | 'decided') {
  const query = db
    .select({
      id: developerApplications.id,
      userId: developerApplications.userId,
      userName: user.name,
      message: developerApplications.message,
      status: developerApplications.status,
      note: developerApplications.note,
      createdAt: developerApplications.createdAt,
      decidedAt: developerApplications.decidedAt,
    })
    .from(developerApplications)
    .innerJoin(user, eq(developerApplications.userId, user.id))
  if (status === 'pending') {
    return query.where(eq(developerApplications.status, 'pending')).orderBy(developerApplications.createdAt).limit(ADMIN_LIST_LIMIT)
  }
  return query
    .where(sql`${developerApplications.status} <> 'pending'`)
    .orderBy(desc(developerApplications.decidedAt))
    .limit(ADMIN_LIST_LIMIT)
}

// 管理员发的码：未用的全部，已用的最近几条
export async function adminInvites() {
  const base = () =>
    db
      .select({
        code: developerInvites.code,
        usedBy: user.name,
        usedAt: developerInvites.usedAt,
        expiresAt: developerInvites.expiresAt,
        revokedAt: developerInvites.revokedAt,
        createdAt: developerInvites.createdAt,
      })
      .from(developerInvites)
      .leftJoin(user, eq(developerInvites.usedBy, user.id))
  const unused = await base()
    .where(and(isNull(developerInvites.ownerId), isNull(developerInvites.usedBy), isNull(developerInvites.revokedAt), gt(developerInvites.expiresAt, new Date())))
    .orderBy(desc(developerInvites.createdAt))
    .limit(ADMIN_LIST_LIMIT)
  const used = await base()
    .where(and(isNull(developerInvites.ownerId), isNotNull(developerInvites.usedBy)))
    .orderBy(desc(developerInvites.usedAt))
    .limit(ADMIN_LIST_LIMIT)
  return { unused, used }
}

export async function listDevelopers() {
  return db
    .select({
      userId: developers.userId,
      name: user.name,
      source: developers.source,
      grantedAt: developers.grantedAt,
      revokedAt: developers.revokedAt,
      revokeReason: developers.revokeReason,
    })
    .from(developers)
    .innerJoin(user, eq(developers.userId, user.id))
    .orderBy(desc(developers.grantedAt))
    .limit(ADMIN_LIST_LIMIT * 2)
}
