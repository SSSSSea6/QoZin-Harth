import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { bearer, customSession, deviceAuthorization, phoneNumber } from 'better-auth/plugins'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { expo } from '@better-auth/expo'
import { normalizePhone, PHONE_ERROR_CODES } from '@harth/shared'
import { HTTPException } from 'hono/http-exception'
import { db } from './db'
import * as authSchema from './db/auth-schema'
import { recordSend, SmsRateLimited } from './domain/phone'
import { assertCanSpeak } from './domain/policy'
import { env, isAdmin } from './env'
import { errorCode } from './http'
import { sendVerificationCode, smsReady } from './sms'

export const CLI_CLIENT_ID = 'harth-cli'
export const APP_SCHEME = 'harth'

const PHONE_PATHS = new Set(['/phone-number/send-otp', '/phone-number/verify'])

// 门禁抛的是 Hono 异常，进了 better-auth 的钩子要换成它认识的错误才有响应体
async function speakingCheck(userId: string): Promise<void> {
  try {
    await assertCanSpeak(db, userId)
  } catch (err) {
    if (err instanceof HTTPException) {
      throw new APIError(err.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', { message: err.message, code: errorCode(err) })
    }
    throw err
  }
}

// 只信 Caddy 填的转发头；本地直连时没有来源 IP
function clientIp(headers: Headers | undefined): string | null {
  const forwarded = headers?.get('x-forwarded-for')
  return forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true },
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_URL, `${APP_SCHEME}://`],
  // 手机号只用于绑定：手机号登录与找回密码两条路不开
  disabledPaths: ['/sign-in/phone-number', '/phone-number/request-password-reset', '/phone-number/reset-password'],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // 手机号只能经验证码写入；注册带上来就是想占别人的号
      if (ctx.path === '/sign-up/email' && (ctx.body as Record<string, unknown> | undefined)?.phoneNumber !== undefined) {
        throw new APIError('BAD_REQUEST', { message: '注册时不能填手机号', code: 'FIELD_NOT_ALLOWED' })
      }
      if (ctx.path === '/update-user') {
        const body = (ctx.body ?? {}) as Record<string, unknown>
        if (body.name !== undefined || body.image !== undefined) {
          const session = await getSessionFromCtx(ctx)
          if (session) await speakingCheck(session.user.id)
        }
        return
      }
      if (!ctx.path || !PHONE_PATHS.has(ctx.path)) return
      const session = await getSessionFromCtx(ctx)
      if (!session) throw new APIError('UNAUTHORIZED', { message: '请先登录' })
      const body = (ctx.body ?? {}) as Record<string, unknown>
      const phone = typeof body.phoneNumber === 'string' ? normalizePhone(body.phoneNumber) : null
      if (!phone) throw new APIError('BAD_REQUEST', { message: '手机号格式不对', code: 'INVALID_PHONE' })
      if (ctx.path === '/phone-number/verify') {
        return { context: { body: { ...body, phoneNumber: phone, updatePhoneNumber: true } } }
      }
      if (!smsReady()) {
        throw new APIError('SERVICE_UNAVAILABLE', { message: PHONE_ERROR_CODES.SMS_UNAVAILABLE, code: 'SMS_UNAVAILABLE' })
      }
      try {
        await db.transaction((tx) => recordSend(tx, { phone, userId: session.user.id, ip: clientIp(ctx.headers) }))
      } catch (err) {
        if (err instanceof SmsRateLimited) {
          throw new APIError('TOO_MANY_REQUESTS', { message: PHONE_ERROR_CODES.SMS_RATE_LIMITED, code: 'SMS_RATE_LIMITED' })
        }
        throw err
      }
      return { context: { body: { ...body, phoneNumber: phone } } }
    }),
  },
  plugins: [
    bearer(),
    expo(),
    phoneNumber({
      sendOTP: ({ phoneNumber: phone, code }) => sendVerificationCode(phone, code),
      phoneNumberValidator: (phone) => normalizePhone(phone) === phone,
    }),
    deviceAuthorization({
      verificationUri: `${env.WEB_URL}/device`,
      validateClient: (clientId) => clientId === CLI_CLIENT_ID,
    }),
    customSession(async ({ user, session }) => ({
      user: { ...user, isAdmin: isAdmin(user) },
      session,
    })),
  ],
})
