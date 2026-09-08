import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { session } from '../db/auth-schema'
import { devices } from '../db/schema'
import { fail } from '../http'

type DeviceRow = typeof devices.$inferSelect

export interface RegisterInput {
  platform: 'ios' | 'android'
  provider: 'apns' | 'emas'
  token: string
  apnsEnv?: 'sandbox' | 'production'
  appVersion?: string
}

// 同一台设备换人登录：改绑并把绑定版本加一，旧任务据此作废
export async function registerDevice(userId: string, sessionId: string, input: RegisterInput): Promise<{ id: string; bindingVersion: number }> {
  if (input.provider === 'apns' && !input.apnsEnv) throw fail(400, 'BAD_REQUEST', 'APNs 设备要带环境')
  const now = new Date()
  const [row] = await db
    .insert(devices)
    .values({
      userId,
      platform: input.platform,
      provider: input.provider,
      token: input.token,
      apnsEnv: input.apnsEnv ?? null,
      appVersion: input.appVersion ?? null,
      sessionId,
      boundAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [devices.provider, devices.token],
      set: {
        userId,
        sessionId,
        appVersion: input.appVersion ?? null,
        apnsEnv: input.apnsEnv ?? null,
        lastSeenAt: now,
        disabledAt: null,
        // 换了人才算新绑定
        bindingVersion: sql`CASE WHEN ${devices.userId} <> excluded.user_id THEN ${devices.bindingVersion} + 1 ELSE ${devices.bindingVersion} END`,
        boundAt: sql`CASE WHEN ${devices.userId} <> excluded.user_id THEN excluded.bound_at ELSE ${devices.boundAt} END`,
      },
    })
    .returning({ id: devices.id, bindingVersion: devices.bindingVersion })
  return { id: row!.id, bindingVersion: row!.bindingVersion }
}

export async function removeDevice(userId: string, id: string, bindingVersion?: number): Promise<boolean> {
  const conditions = [eq(devices.id, id), eq(devices.userId, userId)]
  if (bindingVersion !== undefined) conditions.push(eq(devices.bindingVersion, bindingVersion))
  const rows = await db.delete(devices).where(and(...conditions)).returning({ id: devices.id })
  return rows.length > 0
}

// 能收推送的设备：没禁用，且注册时的会话还有效
export async function activeDevices(userId: string): Promise<DeviceRow[]> {
  return db
    .select({ device: devices })
    .from(devices)
    .innerJoin(session, eq(session.id, devices.sessionId))
    .where(and(eq(devices.userId, userId), isNull(devices.disabledAt), gt(session.expiresAt, new Date())))
    .then((rows) => rows.map((r) => r.device))
}

export async function disableDevice(id: string): Promise<void> {
  await db.update(devices).set({ disabledAt: new Date() }).where(eq(devices.id, id))
}

export async function listDevices(userId: string) {
  return db
    .select({ id: devices.id, platform: devices.platform, appVersion: devices.appVersion, lastSeenAt: devices.lastSeenAt, disabledAt: devices.disabledAt, bindingVersion: devices.bindingVersion })
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(devices.lastSeenAt)
}
