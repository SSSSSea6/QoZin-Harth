import Push, { PushRequest } from '@alicloud/push20160801'
import { $OpenApiUtil } from '@alicloud/openapi-core'
import apn from '@parse/node-apn'
import type { devices } from '../db/schema'
import { env } from '../env'

export type DeviceRow = typeof devices.$inferSelect

export interface PushMessage {
  notificationId: string
  kind: string
  title: string
  body: string
  collapseId: string
}

// 'sent'：平台受理；'unregistered'：设备已失效，停发；抛错：交给队列重试
export type SendResult = 'sent' | 'unregistered'

export interface Transport {
  send(device: DeviceRow, message: PushMessage): Promise<SendResult>
  shutdown(): Promise<void>
}

// 配置类错误（密钥、主题）不是设备的问题，不能重试成功，也不能把设备当坏 token 删掉
export class PushConfigError extends Error {}

const EXPIRY_SECONDS = 24 * 60 * 60
const APNS_UNREGISTERED = new Set(['Unregistered', 'ExpiredToken', 'DeviceTokenNotForTopic'])
const APNS_CONFIG_ERRORS = new Set(['BadCertificate', 'BadCertificateEnvironment', 'Forbidden', 'InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken', 'TopicDisallowed', 'MissingTopic', 'BadDeviceToken'])

function apnsTransport(): Transport | null {
  const config = env.APNS
  if (!config) return null
  const provider = new apn.Provider({
    token: { key: config.key, keyId: config.keyId, teamId: config.teamId },
    production: config.production,
  })
  return {
    async send(device, message) {
      const notification = new apn.Notification()
      notification.topic = config.bundleId
      notification.pushType = 'alert'
      notification.expiry = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS
      notification.collapseId = message.collapseId
      notification.alert = { title: message.title, body: message.body }
      notification.payload = { notificationId: message.notificationId, kind: message.kind }
      const result = await provider.send(notification, device.token)
      const failure = result.failed[0]
      if (!failure) return 'sent'
      const reason = failure.response?.reason ?? failure.error?.message ?? `HTTP ${failure.status ?? '?'}`
      if (APNS_UNREGISTERED.has(reason)) {
        // 410 带失效时间：只作废那之前的绑定，之后重新注册的同一 token 不受影响
        const failedAt = failure.response?.timestamp ? Number(failure.response.timestamp) : Date.now()
        return failedAt >= device.boundAt.getTime() ? 'unregistered' : 'sent'
      }
      if (APNS_CONFIG_ERRORS.has(reason)) throw new PushConfigError(`APNs 配置错误：${reason}`)
      throw new Error(`APNs 暂时失败：${reason}`)
    },
    shutdown: () => provider.shutdown(),
  }
}

function emasTransport(): Transport | null {
  const config = env.EMAS
  if (!config) return null
  const client = new Push(
    new $OpenApiUtil.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      endpoint: `cloudpush.${config.region}.aliyuncs.com`,
    }),
  )
  return {
    async send(device, message) {
      const res = await client.push(
        new PushRequest({
          appKey: Number(config.appKey),
          target: 'DEVICE',
          targetValue: device.token,
          deviceType: 'ANDROID',
          pushType: 'NOTICE',
          title: message.title,
          body: message.body,
          androidExtParameters: JSON.stringify({ notificationId: message.notificationId, kind: message.kind }),
          storeOffline: true,
          expireTime: new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString(),
          jobKey: message.collapseId,
        }),
      )
      if (!res.body?.messageId) throw new Error(`EMAS 未受理（${res.body?.requestId ?? '无 requestId'}）`)
      return 'sent'
    },
    shutdown: async () => {},
  }
}

let transports: Partial<Record<DeviceRow['provider'], Transport>> | null = null

export function transportFor(provider: DeviceRow['provider']): Transport | null {
  transports ??= { apns: apnsTransport() ?? undefined, emas: emasTransport() ?? undefined }
  return transports[provider] ?? null
}

// 测试里替换传输层：只在测试钩子开着时允许
export function useTestTransport(transport: Transport | null): void {
  if (!env.TEST_HOOKS) throw new Error('只有测试钩子能替换发送器')
  transports = transport ? { apns: transport, emas: transport } : null
}

export async function shutdownTransports(): Promise<void> {
  const list = Object.values(transports ?? {})
  transports = null
  await Promise.allSettled(list.map((t) => t?.shutdown()))
}

export function pushReady(): { apns: 'ready' | 'unconfigured'; emas: 'ready' | 'unconfigured' } {
  return { apns: env.APNS ? 'ready' : 'unconfigured', emas: env.EMAS ? 'ready' : 'unconfigured' }
}
