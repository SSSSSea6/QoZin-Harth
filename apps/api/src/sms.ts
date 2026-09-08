import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525'
import { $OpenApiUtil } from '@alicloud/openapi-core'
import { env } from './env'

// 测试短信槽：验证码只留在内存里，由测试钩子读取
const testCodes = new Map<string, string>()

let client: Dysmsapi | null = null

function aliyun(): Dysmsapi {
  if (!env.SMS || env.SMS.provider !== 'aliyun') throw new Error('短信服务未配置')
  client ??= new Dysmsapi(
    new $OpenApiUtil.Config({
      accessKeyId: env.SMS.accessKeyId,
      accessKeySecret: env.SMS.accessKeySecret,
      endpoint: 'dysmsapi.aliyuncs.com',
    }),
  )
  return client
}

export const smsReady = (): boolean => env.SMS !== null

export async function sendVerificationCode(phone: string, code: string): Promise<void> {
  if (!env.SMS) throw new Error('短信服务未配置')
  if (env.SMS.provider === 'test') {
    testCodes.set(phone, code)
    return
  }
  const res = await aliyun().sendSms(
    new SendSmsRequest({
      phoneNumbers: phone,
      signName: env.SMS.signName,
      templateCode: env.SMS.templateCode,
      templateParam: JSON.stringify({ code }),
    }),
  )
  if (res.body?.code !== 'OK') {
    throw new Error(`短信发送失败：${res.body?.code ?? '无响应'} ${res.body?.message ?? ''}（${res.body?.requestId ?? ''}）`.trim())
  }
}

export function lastTestCode(phone: string): string | null {
  if (env.SMS?.provider !== 'test') throw new Error('只有测试短信槽能读验证码')
  return testCodes.get(phone) ?? null
}
