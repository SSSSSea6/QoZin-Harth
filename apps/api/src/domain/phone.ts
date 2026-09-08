import { SMS_LIMITS } from '@harth/shared'
import { and, count, eq, gt, max, sql } from 'drizzle-orm'
import { db } from '../db'
import { smsSends } from '../db/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const KEEP_MS = 7 * DAY

export class SmsRateLimited extends Error {}

// 发码前在同一个事务里数最近的发送记录，超限就不记录也不发
export async function recordSend(tx: Tx, input: { phone: string; userId: string; ip: string | null; now?: Date }): Promise<void> {
  const now = input.now ?? new Date()
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.phone}))`)
  const [phoneStats] = await tx
    .select({ hourly: count(), last: max(smsSends.createdAt) })
    .from(smsSends)
    .where(and(eq(smsSends.phone, input.phone), gt(smsSends.createdAt, new Date(now.getTime() - HOUR))))
  const [phoneDaily] = await tx
    .select({ n: count() })
    .from(smsSends)
    .where(and(eq(smsSends.phone, input.phone), gt(smsSends.createdAt, new Date(now.getTime() - DAY))))
  const [userHourly] = await tx
    .select({ n: count() })
    .from(smsSends)
    .where(and(eq(smsSends.userId, input.userId), gt(smsSends.createdAt, new Date(now.getTime() - HOUR))))
  const [ipHourly] = input.ip
    ? await tx
        .select({ n: count() })
        .from(smsSends)
        .where(and(eq(smsSends.ip, input.ip), gt(smsSends.createdAt, new Date(now.getTime() - HOUR))))
    : [{ n: 0 }]
  const last = phoneStats?.last ? new Date(phoneStats.last).getTime() : 0
  if (
    now.getTime() - last < SMS_LIMITS.cooldownSeconds * 1000 ||
    Number(phoneStats?.hourly ?? 0) >= SMS_LIMITS.perPhoneHourly ||
    Number(phoneDaily?.n ?? 0) >= SMS_LIMITS.perPhoneDaily ||
    Number(userHourly?.n ?? 0) >= SMS_LIMITS.perUserHourly ||
    Number(ipHourly?.n ?? 0) >= SMS_LIMITS.perIpHourly
  ) {
    throw new SmsRateLimited('验证码发得太频繁，稍后再试')
  }
  await tx.insert(smsSends).values({ phone: input.phone, userId: input.userId, ip: input.ip, createdAt: now })
}

export async function cleanupSmsSends(now: Date): Promise<number> {
  const rows = await db
    .delete(smsSends)
    .where(sql`${smsSends.createdAt} < ${new Date(now.getTime() - KEEP_MS)}`)
    .returning({ id: smsSends.id })
  return rows.length
}
