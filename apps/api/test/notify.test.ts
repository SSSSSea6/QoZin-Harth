import { desc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { session } from '../src/db/auth-schema'
import { circles, devices, notifications } from '../src/db/schema'
import { notify } from '../src/domain/notify'
import { seed } from '../src/db/seed'
import { becomeAdmin, TestUser } from './helpers'

const admin = new TestUser('管理员知')
const alice = new TestUser('阿知')
const bob = new TestUser('鲍知')
let aliceId = ''
let bobId = ''
let circleId = ''
let dmId = ''

interface Notification {
  id: string
  kind: string
  eventKey: string
  title: string
  body: string
  count: number
  readAt: string | null
  updatedAt: string
}

async function inbox(user: TestUser): Promise<Notification[]> {
  const { body } = await user.json<{ notifications: Notification[] }>('/api/notifications')
  return body.notifications
}

async function unread(user: TestUser): Promise<number> {
  return (await user.json<{ count: number }>('/api/notifications/unread-count')).body.count
}

beforeAll(async () => {
  await seed()
  await becomeAdmin(admin, 'notify-admin@test.dev')
  aliceId = await alice.signUp('notify-alice@test.dev')
  bobId = await bob.signUp('notify-bob@test.dev')
  for (const u of [admin, alice, bob]) await u.post('/api/circles/nuaa/join')
  const circle = await alice.post<{ circle: { id: string } }>('/api/circles', { name: '通知圈', visibility: 'public', parentIds: ['nuaa'] })
  circleId = circle.body.circle.id
  await bob.post(`/api/circles/${circleId}/join`)
  const dm = await alice.post<{ circle: { id: string } }>('/api/circles/dm', { userId: bobId })
  dmId = dm.body.circle.id
})

describe('收件箱', () => {
  it('私聊消息进对方收件箱；未读时合并，读过后再来是新一条', async () => {
    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '在吗' })).status).toBe(201)
    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '教材还在吗' })).status).toBe(201)
    const list = await inbox(bob)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'dm', title: '阿知 发来消息', body: '教材还在吗', count: 2 })
    expect(await unread(bob)).toBe(1)
    expect(await inbox(alice)).toHaveLength(0)

    const seen = list[0]!.updatedAt
    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '你刚没看到的' })).status).toBe(201)
    const marked = await bob.post<{ updated: number }>('/api/notifications/read', { ids: [list[0]!.id], seenUpdatedAt: seen })
    expect(marked.body.updated).toBe(0)
    expect(await unread(bob)).toBe(1)
    expect((await bob.post<{ updated: number }>('/api/notifications/read', { all: true })).body.updated).toBe(1)
    expect(await unread(bob)).toBe(0)

    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '新的一条' })).status).toBe(201)
    const again = await inbox(bob)
    expect(again).toHaveLength(2)
    expect(again[0]).toMatchObject({ count: 1, readAt: null, body: '新的一条' })
  })

  it('屏蔽后私聊通知不再出现在列表与未读数里', async () => {
    expect((await bob.put(`/api/users/${aliceId}/block`, {})).status).toBe(200)
    expect(await inbox(bob)).toHaveLength(0)
    expect(await unread(bob)).toBe(0)
    await bob.delete(`/api/users/${aliceId}/block`)
    expect(await inbox(bob)).toHaveLength(2)
  })

  it('圈子快熄：只有真正跳进倒计时的那一轮通知全体成员，添柴后再沉寂是新一轮', async () => {
    // 二级圈的沉寂阈值是 90 天
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    await admin.post('/api/test/circle-times', { circleId, lastActivityAt: old })
    await admin.post('/api/test/sweep', {})
    await admin.post('/api/test/sweep', {})
    const mine = (await inbox(bob)).filter((n) => n.kind === 'circle_dying')
    expect(mine).toHaveLength(1)
    expect(mine[0]!.title).toBe('「通知圈」快熄了')
    expect((await inbox(alice)).filter((n) => n.kind === 'circle_dying')).toHaveLength(1)

    expect((await alice.post(`/api/circles/${circleId}/renew`)).status).toBe(200)
    await bob.post('/api/notifications/read', { all: true })
    await admin.post('/api/test/circle-times', { circleId, lastActivityAt: old, hibernationDeadline: null })
    await admin.post('/api/test/sweep', {})
    expect((await inbox(bob)).filter((n) => n.kind === 'circle_dying')).toHaveLength(2)
  })

  it('退圈后圈子类通知不再可见', async () => {
    expect((await bob.post(`/api/circles/${circleId}/leave`)).status).toBe(200)
    expect((await inbox(bob)).filter((n) => n.kind === 'circle_dying')).toHaveLength(0)
    await bob.post(`/api/circles/${circleId}/join`)
  })

  it('事务回滚时通知不落库', async () => {
    const before = (await inbox(alice)).length
    await expect(
      db.transaction(async (tx) => {
        await notify(tx, { kind: 'application', eventKey: 'rollback-test', refType: 'application', refId: 'x', title: '不该出现', body: '', recipients: [aliceId] })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect((await inbox(alice)).length).toBe(before)
    const [row] = await db.select().from(notifications).where(eq(notifications.eventKey, 'rollback-test'))
    expect(row).toBeUndefined()
  })
})

describe('设备与投递', () => {
  let deviceId = ''
  let notificationId = ''

  it('注册设备要登录且归本人；同一 token 换人登录绑定版本加一', async () => {
    const first = await bob.put<{ id: string; bindingVersion: number }>('/api/devices', { platform: 'ios', provider: 'apns', token: 'tok-bob-1', apnsEnv: 'sandbox', appVersion: '1.0.0' })
    expect(first.status).toBe(200)
    expect(first.body.bindingVersion).toBe(1)
    deviceId = first.body.id
    const again = await bob.put<{ id: string; bindingVersion: number }>('/api/devices', { platform: 'ios', provider: 'apns', token: 'tok-bob-1', apnsEnv: 'sandbox' })
    expect(again.body).toMatchObject({ id: deviceId, bindingVersion: 1 })
    const stolen = await alice.put<{ id: string; bindingVersion: number }>('/api/devices', { platform: 'ios', provider: 'apns', token: 'tok-bob-1', apnsEnv: 'sandbox' })
    expect(stolen.body).toMatchObject({ id: deviceId, bindingVersion: 2 })
    expect((await bob.delete(`/api/devices/${deviceId}?bindingVersion=1`)).status).toBe(200)
    const [row] = await db.select().from(devices).where(eq(devices.id, deviceId))
    expect(row?.userId).toBe(aliceId)
    expect((await alice.delete(`/api/devices/${deviceId}?bindingVersion=2`)).status).toBe(200)
    expect(await db.select().from(devices).where(eq(devices.id, deviceId))).toHaveLength(0)
  })

  it('外发只给会话仍有效的设备；每台一条投递记录，失败台单独重试', async () => {
    const reg = await bob.put<{ id: string }>('/api/devices', { platform: 'android', provider: 'emas', token: 'emas-bob-1' })
    deviceId = reg.body.id
    const other = await bob.put<{ id: string }>('/api/devices', { platform: 'ios', provider: 'apns', token: 'tok-bob-2', apnsEnv: 'sandbox' })
    await admin.post('/api/test/transport', { mode: 'record' })
    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '推一下' })).status).toBe(201)
    const [latest] = await inbox(bob)
    notificationId = latest!.id
    const report = await admin.post<{ sent: number; failed: number; skipped: number }>('/api/test/deliver', { notificationId })
    expect(report.body).toMatchObject({ sent: 2, failed: 0, skipped: 0 })
    const log = await admin.json<{ sent: { deviceId: string; notificationId: string }[] }>('/api/test/transport')
    expect(log.body.sent.map((s) => s.deviceId).sort()).toEqual([deviceId, other.body.id].sort())

    // 已送达的设备不重发；会话失效的设备不再送
    const rerun = await admin.post<{ sent: number }>('/api/test/deliver', { notificationId })
    expect(rerun.body.sent).toBe(0)
    await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.userId, bobId))
    await admin.post('/api/test/transport', { mode: 'record' })
    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '再推' })).status).toBe(201)
    const [next] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, bobId)).orderBy(desc(notifications.createdAt)).limit(1)
    const quiet = await admin.post<{ sent: number; skipped: number }>('/api/test/deliver', { notificationId: next!.id })
    expect(quiet.body.sent).toBe(0)
    await db.update(session).set({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) }).where(eq(session.userId, bobId))
  })

  it('设备失效即禁用，配置错误不重试，暂时失败交给队列', async () => {
    const carol = new TestUser('卡知')
    const carolId = await carol.signUp('notify-carol@test.dev')
    const dm = await alice.post<{ circle: { id: string } }>('/api/circles/dm', { userId: carolId })
    const dev = await carol.put<{ id: string }>('/api/devices', { platform: 'android', provider: 'emas', token: 'emas-carol' })
    await admin.post('/api/test/transport', { mode: 'fail' })
    await alice.post(`/api/circles/${dm.body.circle.id}/messages`, { content: '一' })
    const [n1] = await inbox(carol)
    const failed = await admin.post<{ retry?: boolean; failed?: number }>('/api/test/deliver', { notificationId: n1!.id })
    expect(failed.status).toBe(202)
    await admin.post('/api/test/transport', { mode: 'config-error' })
    const config = await admin.post<{ failed: number; retry: boolean }>('/api/test/deliver', { notificationId: n1!.id })
    expect(config.status).toBe(200)
    expect(config.body).toMatchObject({ failed: 1, retry: false })
    await admin.post('/api/test/transport', { mode: 'unregistered' })
    const gone = await admin.post<{ failed: number }>('/api/test/deliver', { notificationId: n1!.id })
    expect(gone.body.failed).toBe(1)
    const [row] = await db.select().from(devices).where(eq(devices.id, dev.body.id))
    expect(row?.disabledAt).not.toBeNull()
    await admin.post('/api/test/transport', { mode: 'off' })
  })

  it('圈子归档后，快熄与私聊通知都不再给出', async () => {
    await db.update(circles).set({ archivedAt: new Date() }).where(eq(circles.id, dmId))
    expect((await inbox(bob)).filter((n) => n.kind === 'dm')).toHaveLength(0)
    await db.update(circles).set({ archivedAt: null }).where(eq(circles.id, dmId))
  })
})
