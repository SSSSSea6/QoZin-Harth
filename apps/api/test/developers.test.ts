import {
  billingMonth,
  FUEL_ALLOWANCE,
  FUEL_RATES,
  FUEL_RUN_RESERVE,
  fuelForStorageWrite,
  INVITES_PER_DEVELOPER,
  TOOL_RUN_ERROR_CODES,
} from '@harth/shared'
import { and, eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { developerInvites, fuelAccounts, toolUsage } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { chargeFuel } from '../src/tools/fuel'
import { becomeAdmin, makeDeveloper, TestUser } from './helpers'

const admin = new TestUser('管理员三')
const alice = new TestUser('阿丽')
const bob = new TestUser('鲍勃')
const carol = new TestUser('卡罗')
const owner = new TestUser('圈主三')
let adminId = ''
let aliceId = ''
let carolId = ''
let circleId = ''

const SLUG = 'fuel-tool'

const SERVER_JS = `
export default {
  async tally(harth) {
    const item = await harth.storage.get('count')
    const next = (item ? item.value : 0) + 1
    await harth.storage.set('count', next)
    return { count: next }
  },
  async remind(harth) {
    await harth.posts.create({ title: '提醒' })
  },
}
`

const manifest = {
  slug: SLUG,
  name: '燃料测试',
  version: '1.0.0',
  description: '计量测试用的工具',
  backend: 'server.js',
  permissions: ['user.profile', 'storage', 'posts.write', 'schedule'],
  actions: [
    { name: 'tally', description: '计数' },
    { name: 'remind', description: '提醒', triggers: ['schedule'] },
  ],
  schedules: [{ name: 'morning', cron: '0 8 * * 1-5', action: 'remind' }],
}

function bundle(): Uint8Array {
  return zipSync({
    'harth.json': strToU8(JSON.stringify(manifest)),
    'index.html': strToU8('<!doctype html><script src="/_harth/sdk.js"></script><p>燃料</p>'),
    'server.js': strToU8(SERVER_JS),
  })
}

async function publish(user: TestUser) {
  const zip = bundle()
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
  return user.json<{ version: { id: string; status: string }; error?: string }>('/api/tools/publish', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/zip' },
  })
}

async function toolApi(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init.body) headers.set('content-type', 'application/json')
  const res = await app.request(`/api/tool${path}`, { ...init, headers })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

async function account(ownerId: string) {
  const [row] = await db
    .select()
    .from(fuelAccounts)
    .where(and(eq(fuelAccounts.ownerId, ownerId), eq(fuelAccounts.month, billingMonth())))
  return row ?? null
}

async function setUsed(ownerId: string, used: number) {
  await db
    .insert(fuelAccounts)
    .values({ ownerId, month: billingMonth(), used, rateVersion: 1 })
    .onConflictDoUpdate({ target: [fuelAccounts.ownerId, fuelAccounts.month], set: { used, reserved: 0 } })
}

async function memberToken(): Promise<string> {
  const res = await owner.post<{ token: string }>(`/api/circles/${circleId}/tools/${SLUG}/token`)
  expect(res.status).toBe(200)
  return res.body.token
}

async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!ok(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
    value = await read()
  }
  return value
}

beforeAll(async () => {
  await seed()
  adminId = await becomeAdmin(admin, 'admin3@test.dev')
  aliceId = await alice.signUp('dev-alice@test.dev')
  await bob.signUp('dev-bob@test.dev')
  carolId = await carol.signUp('dev-carol@test.dev')
  await owner.signUp('dev-owner@test.dev')
  for (const u of [alice, bob, carol, owner]) await u.post('/api/circles/nuaa/join')
  const created = await owner.post<{ circle: { id: string } }>('/api/circles', {
    name: '燃料圈',
    visibility: 'public',
    parentIds: ['nuaa'],
  })
  circleId = created.body.circle.id
})

describe('开发者资格', () => {
  it('没有资格不能发布；普通用户碰不到管理员接口', async () => {
    const { status, body } = await publish(carol)
    expect(status).toBe(403)
    expect(body.error).toContain('开发者资格')
    expect((await carol.json('/api/developers/applications')).status).toBe(403)
    expect((await carol.post('/api/developers/invites', { count: 1 })).status).toBe(403)
    expect((await carol.post(`/api/developers/${aliceId}/revoke`, { reason: 'x' })).status).toBe(403)
  })

  it('申请 → 管理员通过 → 拿到首批邀请码', async () => {
    const applied = await alice.post('/api/developers/apply', { message: '想做一个值日表' })
    expect(applied.status).toBe(201)
    expect((await alice.post('/api/developers/apply', { message: '再申请一次' })).status).toBe(409)
    const me = await alice.json<{ status: string; application: { status: string } }>('/api/developers/me')
    expect(me.body.status).toBe('none')
    expect(me.body.application.status).toBe('pending')

    const pending = await admin.json<{ applications: { id: string; userId: string; message: string }[] }>(
      '/api/developers/applications',
    )
    const mine = pending.body.applications.find((a) => a.userId === aliceId)!
    expect(mine.message).toBe('想做一个值日表')
    const decided = await admin.post<{ codes: string[] }>(`/api/developers/applications/${mine.id}/decide`, {
      decision: 'approve',
    })
    expect(decided.status).toBe(200)
    expect(decided.body.codes).toHaveLength(INVITES_PER_DEVELOPER)
    expect((await admin.post(`/api/developers/applications/${mine.id}/decide`, { decision: 'approve' })).status).toBe(409)

    const after = await alice.json<{ status: string; invites: { code: string }[]; usage: { allowance: number } }>(
      '/api/developers/me',
    )
    expect(after.body.status).toBe('active')
    expect(after.body.invites).toHaveLength(INVITES_PER_DEVELOPER)
    expect(after.body.usage.allowance).toBe(FUEL_ALLOWANCE.developer)
    expect((await publish(alice)).status).toBe(201)
  })

  it('驳回要写原因，驳回后能再申请', async () => {
    expect((await carol.post('/api/developers/apply', { message: '我也想做' })).status).toBe(201)
    const pending = await admin.json<{ applications: { id: string; userId: string }[] }>('/api/developers/applications')
    const mine = pending.body.applications.find((a) => a.userId === carolId)!
    expect((await admin.post(`/api/developers/applications/${mine.id}/decide`, { decision: 'reject' })).status).toBe(400)
    const rejected = await admin.post(`/api/developers/applications/${mine.id}/decide`, {
      decision: 'reject',
      note: '先说清楚要做什么',
    })
    expect(rejected.status).toBe(200)
    const me = await carol.json<{ status: string; application: { status: string; note: string }; usage: { allowance: number } }>(
      '/api/developers/me',
    )
    expect(me.body.status).toBe('none')
    expect(me.body.application).toMatchObject({ status: 'rejected', note: '先说清楚要做什么' })
    expect(me.body.usage.allowance).toBe(FUEL_ALLOWANCE.basic)
    expect((await carol.post('/api/developers/apply', { message: '做一个签到表' })).status).toBe(201)
  })

  it('邀请码一码一人，无效、用过、过期的都拒', async () => {
    expect((await admin.post('/api/developers/invites', { count: 0 })).status).toBe(400)
    expect((await admin.post('/api/developers/invites', { count: 21 })).status).toBe(400)
    const issued = await admin.post<{ codes: string[] }>('/api/developers/invites', { count: 2 })
    expect(issued.status).toBe(201)
    const [first, second] = issued.body.codes as [string, string]

    const redeemed = await bob.post<{ codes: string[] }>('/api/developers/redeem', {
      code: `${first.slice(0, 5)}-${first.slice(5).toLowerCase()}`,
    })
    expect(redeemed.status).toBe(201)
    expect(redeemed.body.codes).toHaveLength(INVITES_PER_DEVELOPER)
    expect((await bob.post('/api/developers/redeem', { code: second })).status).toBe(409)
    expect((await carol.post('/api/developers/redeem', { code: first })).status).toBe(404)
    expect((await carol.post('/api/developers/redeem', { code: 'ZZZZZZZZZZ' })).status).toBe(404)
    expect((await carol.post('/api/developers/redeem', { code: 'short' })).status).toBe(400)

    await db.insert(developerInvites).values({
      code: 'EXPXREDAAA',
      ownerId: null,
      createdBy: adminId,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect((await carol.post('/api/developers/redeem', { code: 'EXPXREDAAA' })).status).toBe(404)

    const listed = await admin.json<{ unused: { code: string }[]; used: { code: string; usedBy: string }[] }>('/api/developers/invites')
    expect(listed.body.unused.map((i) => i.code)).toContain(second)
    expect(listed.body.used.find((i) => i.code === first)?.usedBy).toBe('鲍勃')
  })

  it('两人同时兑换同一个码只有一人成功', async () => {
    const issued = await admin.post<{ codes: string[] }>('/api/developers/invites', { count: 1 })
    const code = issued.body.codes[0]!
    const x = new TestUser('并发甲')
    const y = new TestUser('并发乙')
    await x.signUp('race-x@test.dev')
    await y.signUp('race-y@test.dev')
    const results = await Promise.all([
      x.post('/api/developers/redeem', { code }),
      y.post('/api/developers/redeem', { code }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 404])
  })

  it('撤销后不能发布，转发的码作废，兑换别的码也不能复活；恢复后照旧', async () => {
    const before = await bob.json<{ invites: { code: string }[] }>('/api/developers/me')
    const bobCode = before.body.invites[0]!.code
    const bobId = (await db.select({ id: developerInvites.ownerId }).from(developerInvites).where(eq(developerInvites.code, bobCode)))[0]!.id!
    expect((await admin.post(`/api/developers/${bobId}/revoke`, { reason: '测试撤销' })).status).toBe(200)
    expect((await admin.post(`/api/developers/${bobId}/revoke`, { reason: '再撤' })).status).toBe(404)

    const me = await bob.json<{ status: string; developer: { revokeReason: string } }>('/api/developers/me')
    expect(me.body.status).toBe('revoked')
    expect(me.body.developer.revokeReason).toBe('测试撤销')
    const refused = await publish(bob)
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('撤销')
    expect((await carol.post('/api/developers/redeem', { code: bobCode })).status).toBe(404)
    const fresh = await admin.post<{ codes: string[] }>('/api/developers/invites', { count: 1 })
    expect((await bob.post('/api/developers/redeem', { code: fresh.body.codes[0] })).status).toBe(403)
    expect((await bob.post('/api/developers/apply', { message: '让我回来' })).status).toBe(403)

    expect((await admin.post(`/api/developers/${bobId}/restore`)).status).toBe(200)
    expect((await bob.json<{ status: string }>('/api/developers/me')).body.status).toBe('active')
  })
})

describe('燃料', () => {
  let token = ''

  beforeAll(async () => {
    const pending = await alice.json<{ tools: { slug: string; versions: { id: string; status: string }[] }[] }>('/api/tools/mine')
    const version = pending.body.tools.find((t) => t.slug === SLUG)!.versions[0]!
    expect((await admin.post(`/api/tools/versions/${version.id}/review`, { decision: 'approve' })).status).toBe(200)
    expect((await owner.post(`/api/circles/${circleId}/tools/${SLUG}`)).status).toBe(201)
    token = await memberToken()
  })

  it('写入按字节记账，读取和删除免费', async () => {
    const value = '中'.repeat(2000)
    const bytes = Buffer.byteLength(JSON.stringify(value))
    const put = await toolApi(token, '/storage/greeting', { method: 'PUT', body: JSON.stringify({ value }) })
    expect(put.status).toBe(200)
    const row = await account(aliceId)
    expect(row?.used).toBe(fuelForStorageWrite(bytes))
    expect((await toolApi(token, '/storage/greeting')).status).toBe(200)
    expect((await toolApi(token, '/storage/greeting', { method: 'DELETE' })).status).toBe(200)
    expect((await account(aliceId))?.used).toBe(fuelForStorageWrite(bytes))
    const [usage] = await db.select().from(toolUsage).where(eq(toolUsage.ownerId, aliceId))
    expect(usage).toMatchObject({ storageWrites: 1, storageWriteBytes: bytes })
  })

  it('单个值按 UTF-8 字节算上限', async () => {
    const big = '中'.repeat(22_000)
    const put = await toolApi(token, '/storage/big', { method: 'PUT', body: JSON.stringify({ value: big }) })
    expect(put.status).toBe(413)
  })

  it('发帖记 5 燃料；额度用完后写入与发帖 429、读取正常，换账期从零开始', async () => {
    const before = (await account(aliceId))!.used
    const posted = await toolApi(token, '/posts', { method: 'POST', body: JSON.stringify({ title: '燃料帖' }) })
    expect(posted.status).toBe(201)
    expect((await account(aliceId))!.used).toBe(before + FUEL_RATES.post)

    await setUsed(aliceId, FUEL_ALLOWANCE.developer)
    const put = await toolApi(token, '/storage/k', { method: 'PUT', body: JSON.stringify({ value: 1 }) })
    expect(put.status).toBe(429)
    expect(put.body.error).toBe(TOOL_RUN_ERROR_CODES.QUOTA)
    expect((await toolApi(token, '/posts', { method: 'POST', body: JSON.stringify({ title: '再发' }) })).status).toBe(429)
    expect((await toolApi(token, '/storage')).status).toBe(200)
    expect((await toolApi(token, '/storage/nothing', { method: 'DELETE' })).status).toBe(200)
    const call = await toolApi(token, '/actions/tally', { method: 'POST', body: JSON.stringify({}) })
    expect(call.status).toBe(429)

    const nextMonth = new Date()
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 15)
    const tools = await alice.json<{ tools: { slug: string }[] }>('/api/tools/mine')
    expect(tools.body.tools.some((t) => t.slug === SLUG)).toBe(true)
    const toolId = (await db.select({ id: toolUsage.toolId }).from(toolUsage).where(eq(toolUsage.ownerId, aliceId)))[0]!.id
    expect(await chargeFuel(db, { ownerId: aliceId, toolId, units: 100, at: nextMonth })).toBe(true)
    await setUsed(aliceId, 0)
  })

  it('后端运行先预留后结算，账户与明细一致', async () => {
    const before = (await account(aliceId))!
    const call = await toolApi(token, '/actions/tally', { method: 'POST', body: JSON.stringify({}) })
    expect(call.status, JSON.stringify(call.body)).toBe(200)
    const row = await waitFor(() => account(aliceId), (a) => a !== null && a.reserved === 0 && a.used > before.used)
    expect(row!.used).toBeGreaterThanOrEqual(before.used + FUEL_RATES.run + fuelForStorageWrite(1))
    expect(row!.used).toBeLessThan(before.used + FUEL_RUN_RESERVE + fuelForStorageWrite(1))
    const mine = await alice.json<{ tools: { slug: string; installs: number; week: { runs: number; ok: number } }[]; usage: { used: number } }>(
      '/api/tools/mine',
    )
    const tool = mine.body.tools.find((t) => t.slug === SLUG)!
    expect(tool.installs).toBe(1)
    expect(tool.week.ok).toBeGreaterThanOrEqual(1)
    expect(mine.body.usage.used).toBe(row!.used)
  })

  it('定时运行没额度时记 skipped(QUOTA)，有额度就排队', async () => {
    await setUsed(aliceId, FUEL_ALLOWANCE.developer)
    await admin.post('/api/test/tool-schedules-due', { circleId, slug: SLUG })
    const skipped = await admin.post<{ created: number; skipped: number }>('/api/test/tool-tick', {})
    expect(skipped.body).toMatchObject({ created: 0, skipped: 1 })
    const runs = await owner.json<{ runs: { status: string; errorCode: string | null }[] }>(`/api/circles/${circleId}/tools/${SLUG}/runs`)
    expect(runs.body.runs[0]).toMatchObject({ status: 'skipped', errorCode: 'QUOTA' })

    await setUsed(aliceId, 0)
    await admin.post('/api/test/tool-schedules-due', { circleId, slug: SLUG })
    const created = await admin.post<{ created: number; skipped: number }>('/api/test/tool-tick', {})
    expect(created.body.created).toBe(1)
    await waitFor(() => account(aliceId), (a) => a !== null && a.reserved === 0 && a.used > 0)
  })

  it('存储持有费一天只记一次', async () => {
    const first = await admin.post<{ owners: number; units: number }>('/api/test/fuel-holding', {})
    expect(first.body.owners).toBeGreaterThanOrEqual(1)
    const second = await admin.post<{ owners: number; units: number }>('/api/test/fuel-holding', {})
    expect(second.body.owners).toBe(0)
  })

  it('请求太密集会被限频', async () => {
    const results = []
    for (let i = 0; i < 25; i++) results.push((await toolApi(token, '/storage')).status)
    expect(results).toContain(200)
    expect(results).toContain(429)
  })
})
