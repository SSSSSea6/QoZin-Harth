import { SMS_LIMITS } from '@harth/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { smsSends } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { TestUser } from './helpers'

const alice = new TestUser('阿绑')
const bob = new TestUser('鲍绑')
let aliceId = ''
let bobId = ''

const PHONE = '138 0000 0101'
const E164 = '+8613800000101'

async function codeFor(phone: string): Promise<string> {
  const { body } = await alice.json<{ code: string | null }>(`/api/test/sms?phone=${encodeURIComponent(phone)}`)
  expect(body.code).toMatch(/^\d{6}$/)
  return body.code!
}

async function sessionUser(user: TestUser) {
  const { body } = await user.json<{ user: { phoneNumber: string | null; phoneNumberVerified: boolean | null } }>('/api/auth/get-session')
  return body.user
}

beforeAll(async () => {
  await seed()
  aliceId = await alice.signUp('phone-alice@test.dev', { phone: false })
  bobId = await bob.signUp('phone-bob@test.dev', { phone: false })
})

describe('手机号绑定', () => {
  it('没登录不能发码也不能验证', async () => {
    const guest = new TestUser('路人')
    expect((await guest.post('/api/auth/phone-number/send-otp', { phoneNumber: PHONE })).status).toBe(401)
    expect((await guest.post('/api/auth/phone-number/verify', { phoneNumber: PHONE, code: '000000' })).status).toBe(401)
  })

  it('注册时夹带手机号字段会被拒绝', async () => {
    const sneaky = new TestUser('夹带')
    const base = { email: 'phone-sneaky@test.dev', password: 'password-123', name: '夹带' }
    const withPhone = await sneaky.post<{ code?: string }>('/api/auth/sign-up/email', { ...base, phoneNumber: '+8613800000999' })
    expect(withPhone.status).toBe(400)
    expect(withPhone.body.code).toBe('FIELD_NOT_ALLOWED')
    const withVerified = await sneaky.post<{ code?: string }>('/api/auth/sign-up/email', { ...base, phoneNumberVerified: true })
    expect(withVerified.status).toBe(400)
    expect(withVerified.body.code).toBe('FIELD_NOT_ALLOWED')
  })

  it('手机号登录与找回密码两条路关着', async () => {
    const post = (path: string, body: unknown) =>
      alice.req(path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.status)
    expect(await post('/api/auth/sign-in/phone-number', { phoneNumber: E164, password: 'x' })).toBe(404)
    expect(await post('/api/auth/phone-number/request-password-reset', { phoneNumber: E164 })).toBe(404)
    expect(await post('/api/auth/phone-number/reset-password', { phoneNumber: E164, otp: '000000', password: 'x' })).toBe(404)
  })

  it('格式不对的号码直接拒绝', async () => {
    const res = await alice.post<{ code?: string }>('/api/auth/phone-number/send-otp', { phoneNumber: '12345' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_PHONE')
  })

  it('发码、错码三次作废、冷却期内不能再发', async () => {
    expect((await alice.post('/api/auth/phone-number/send-otp', { phoneNumber: PHONE })).status).toBe(200)
    const code = await codeFor(E164)
    for (let i = 0; i < 3; i++) {
      expect((await alice.post('/api/auth/phone-number/verify', { phoneNumber: PHONE, code: '000000' })).status).toBe(400)
    }
    expect((await alice.post('/api/auth/phone-number/verify', { phoneNumber: PHONE, code })).status).toBe(403)
    const again = await alice.post<{ code?: string }>('/api/auth/phone-number/send-otp', { phoneNumber: PHONE })
    expect(again.status).toBe(429)
    expect(again.body.code).toBe('SMS_RATE_LIMITED')
  })

  it('伪造 updatePhoneNumber 也只会绑到当前账号，不会拿到别的会话', async () => {
    await db.delete(smsSends)
    expect((await alice.post('/api/auth/phone-number/send-otp', { phoneNumber: E164 })).status).toBe(200)
    const code = await codeFor(E164)
    const cookieBefore = alice.cookie
    const res = await alice.post<{ status: boolean; token: string | null; user: { id: string } }>('/api/auth/phone-number/verify', {
      phoneNumber: PHONE,
      code,
      updatePhoneNumber: false,
      disableSession: false,
    })
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(aliceId)
    expect(alice.cookie).toBe(cookieBefore)
    const me = await sessionUser(alice)
    expect(me.phoneNumber).toBe(E164)
    expect(me.phoneNumberVerified).toBe(true)
  })

  it('同一个号不能绑第二个账号', async () => {
    await db.delete(smsSends)
    expect((await bob.post('/api/auth/phone-number/send-otp', { phoneNumber: PHONE })).status).toBe(200)
    const code = await codeFor(E164)
    const res = await bob.post('/api/auth/phone-number/verify', { phoneNumber: PHONE, code })
    expect(res.status).toBe(400)
    expect((await sessionUser(bob)).phoneNumber).toBeNull()
  })

  it('改资料不能改号也不能标成已验证，解绑后门禁重新生效', async () => {
    expect((await alice.post('/api/auth/update-user', { phoneNumberVerified: false })).status).toBe(400)
    expect((await alice.post('/api/auth/update-user', { phoneNumber: '+8613800000404' })).status).toBe(400)
    expect((await sessionUser(alice)).phoneNumber).toBe(E164)
    expect((await alice.post('/api/auth/update-user', { phoneNumber: null })).status).toBe(200)
    const me = await sessionUser(alice)
    expect(me.phoneNumber).toBeNull()
    expect(me.phoneNumberVerified).not.toBe(true)
    expect((await bob.post('/api/auth/update-user', { phoneNumberVerified: true })).status).toBe(400)
  })

  it('同号每小时与每天、同账号每小时都有上限', async () => {
    await db.delete(smsSends)
    const now = Date.now()
    const rows = Array.from({ length: SMS_LIMITS.perPhoneHourly }, (_, i) => ({
      phone: '+8613800000202',
      userId: bobId,
      ip: null,
      createdAt: new Date(now - (i + 2) * 60_000),
    }))
    await db.insert(smsSends).values(rows)
    expect((await bob.post('/api/auth/phone-number/send-otp', { phoneNumber: '13800000202' })).status).toBe(429)
    expect((await bob.post('/api/auth/phone-number/send-otp', { phoneNumber: '13800000303' })).status).toBe(429)
    expect((await alice.post('/api/auth/phone-number/send-otp', { phoneNumber: '13800000303' })).status).toBe(200)
  })
})
