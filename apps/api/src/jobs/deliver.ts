import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { circleNotify, notificationDeliveries, notifications } from '../db/schema'
import { activeDevices, disableDevice } from '../domain/devices'
import { stillAllowed } from '../domain/notify'
import { PushConfigError, transportFor, type DeviceRow } from '../push/transports'

export interface DeliveryReport {
  sent: number
  failed: number
  skipped: number
  retry: boolean
}

// 出队时按当时权限重新判断，逐设备记结果；只有暂时性失败才让队列重试
export async function deliverNotification(notificationId: string): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, failed: 0, skipped: 0, retry: false }
  const [notification] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1)
  if (!notification || notification.readAt || !(await stillAllowed(notification))) return report
  if (notification.kind === 'tool_post' && notification.circleId) {
    const [pref] = await db
      .select({ level: circleNotify.level })
      .from(circleNotify)
      .where(and(eq(circleNotify.circleId, notification.circleId), eq(circleNotify.userId, notification.userId)))
      .limit(1)
    if (pref?.level === 'none') return report
  }
  const targets = await activeDevices(notification.userId)
  if (targets.length === 0) return report
  const done = await db
    .select({ deviceId: notificationDeliveries.deviceId, status: notificationDeliveries.status, bindingVersion: notificationDeliveries.bindingVersion })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.notificationId, notification.id),
        inArray(
          notificationDeliveries.deviceId,
          targets.map((d) => d.id),
        ),
      ),
    )
  const finished = new Set(done.filter((d) => d.status === 'sent').map((d) => `${d.deviceId}:${d.bindingVersion}`))
  const message = {
    notificationId: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    collapseId: notification.eventKey,
  }
  let retry = false
  for (const device of targets) {
    if (finished.has(`${device.id}:${device.bindingVersion}`)) continue
    const outcome = await sendOne(device, message)
    await db
      .insert(notificationDeliveries)
      .values({
        notificationId: notification.id,
        deviceId: device.id,
        bindingVersion: device.bindingVersion,
        status: outcome.status,
        lastError: outcome.error ?? null,
        sentAt: outcome.status === 'sent' ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [notificationDeliveries.notificationId, notificationDeliveries.deviceId],
        set: {
          bindingVersion: device.bindingVersion,
          status: outcome.status,
          lastError: outcome.error ?? null,
          sentAt: outcome.status === 'sent' ? new Date() : null,
          attempts: (await attemptsOf(notification.id, device.id)) + 1,
          updatedAt: new Date(),
        },
      })
    report[outcome.status]++
    if (outcome.retry) retry = true
  }
  report.retry = retry
  if (retry) throw new Error(`部分设备投递暂时失败，等待重试（通知 ${notification.id}）`)
  return report
}

async function attemptsOf(notificationId: string, deviceId: string): Promise<number> {
  const [row] = await db
    .select({ attempts: notificationDeliveries.attempts })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.notificationId, notificationId), eq(notificationDeliveries.deviceId, deviceId)))
    .limit(1)
  return row?.attempts ?? 0
}

async function sendOne(
  device: DeviceRow,
  message: { notificationId: string; kind: string; title: string; body: string; collapseId: string },
): Promise<{ status: 'sent' | 'failed' | 'skipped'; error?: string; retry?: boolean }> {
  const transport = transportFor(device.provider)
  if (!transport) return { status: 'skipped', error: `${device.provider} 未配置` }
  try {
    const result = await transport.send(device, message)
    if (result === 'unregistered') {
      await disableDevice(device.id)
      return { status: 'failed', error: '设备已失效' }
    }
    return { status: 'sent' }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    if (err instanceof PushConfigError) {
      console.error('[push] 配置错误，不重试', text)
      return { status: 'failed', error: text }
    }
    return { status: 'failed', error: text, retry: true }
  }
}
