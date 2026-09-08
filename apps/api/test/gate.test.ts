import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { userRestrictions } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { TestUser } from './helpers'

const alice = new TestUser('阿门')
const nophone = new TestUser('没绑')
let aliceId = ''
let nophoneId = ''
let circleId = ''
let postId = ''
let dmId = ''

type Err = { error: string; code?: string }

beforeAll(async () => {
  await seed()
  aliceId = await alice.signUp('gate-alice@test.dev')
  nophoneId = await nophone.signUp('gate-nophone@test.dev', { phone: false })
  await alice.post('/api/circles/nuaa/join')
  await nophone.post('/api/circles/nuaa/join')
  const circle = await alice.post<{ circle: { id: string } }>('/api/circles', { name: '门禁圈', visibility: 'public', parentIds: ['nuaa'] })
  circleId = circle.body.circle.id
  await nophone.post(`/api/circles/${circleId}/join`)
  const post = await alice.post<{ post: { id: string } }>(`/api/posts/circles/${circleId}`, {
    templateKey: 'discussion',
    fields: { title: '门禁测试', body: '正文' },
  })
  postId = post.body.post.id
  const dm = await alice.post<{ circle: { id: string } }>('/api/circles/dm', { userId: nophoneId })
  dmId = dm.body.circle.id
})

describe('发言门禁', () => {
  it('健康检查报告门禁与短信状态', async () => {
    const res = await app.request('/health')
    expect(await res.json()).toEqual({ ok: true, mode: 'preview', phoneRequired: true, sms: 'ready' })
  })

  it('没绑手机号：发帖、回复、建圈、建私聊、发消息、改昵称都被拦', async () => {
    const attempts: Array<[string, unknown]> = [
      [`/api/posts/circles/${circleId}`, { templateKey: 'discussion', fields: { title: '没绑', body: '正文' } }],
      [`/api/posts/${postId}/comments`, { content: '回复' }],
      ['/api/circles', { name: '没绑圈', visibility: 'public', parentIds: ['nuaa'] }],
      ['/api/circles/dm', { userId: aliceId }],
      [`/api/circles/${dmId}/messages`, { content: '你好' }],
    ]
    for (const [path, body] of attempts) {
      const res = await nophone.post<Err>(path, body)
      expect(res.status, path).toBe(403)
      expect(res.body.code, path).toBe('PHONE_REQUIRED')
    }
    const renamed = await nophone.post<{ code?: string }>('/api/auth/update-user', { name: '改名' })
    expect(renamed.status).toBe(403)
    expect(renamed.body.code).toBe('PHONE_REQUIRED')
    expect((await nophone.post('/api/auth/update-user', { phoneNumber: null })).status).toBe(200)
  })

  it('加圈退圈、看内容不要求手机号', async () => {
    expect((await nophone.json(`/api/posts/${postId}`)).status).toBe(200)
    expect((await nophone.post(`/api/circles/${circleId}/leave`)).status).toBe(200)
    expect((await nophone.post(`/api/circles/${circleId}/join`)).status).toBe(201)
  })

  it('绑定后放行', async () => {
    await nophone.post('/api/test/verify-phone', { userId: nophoneId })
    const res = await nophone.post(`/api/posts/${postId}/comments`, { content: '绑好了' })
    expect(res.status).toBe(201)
  })

  it('禁言期间不能发言，但能导出', async () => {
    await db.insert(userRestrictions).values({
      userId: nophoneId,
      kind: 'mute',
      until: new Date(Date.now() + 60 * 60 * 1000),
      reason: '刷屏',
      moderationId: 'm-test',
    })
    const res = await nophone.post<Err>(`/api/posts/${postId}/comments`, { content: '还想说' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('MUTED')
    expect((await nophone.req('/api/users/me/export')).status).toBe(200)
    expect((await nophone.json(`/api/posts/${postId}`)).status).toBe(200)
  })

  it('禁言到期自动恢复', async () => {
    await db.update(userRestrictions).set({ until: new Date(Date.now() - 1000) }).where(eq(userRestrictions.userId, nophoneId))
    expect((await nophone.post(`/api/posts/${postId}/comments`, { content: '回来了' })).status).toBe(201)
  })

  it('封禁后只剩导出、注销与申诉，别的一律 BANNED', async () => {
    await db.update(userRestrictions).set({ kind: 'ban', until: null, reason: '严重违规' }).where(eq(userRestrictions.userId, nophoneId))
    const read = await nophone.json<Err>(`/api/posts/${postId}`)
    expect(read.status).toBe(403)
    expect(read.body.code).toBe('BANNED')
    const say = await nophone.post<Err>(`/api/circles/${dmId}/messages`, { content: '你好' })
    expect(say.status).toBe(403)
    expect(say.body.code).toBe('BANNED')
    expect((await nophone.req('/api/users/me/export')).status).toBe(200)
    expect((await nophone.post('/api/users/me/delete', { password: 'wrong' })).status).toBe(403)
    await db.delete(userRestrictions).where(eq(userRestrictions.userId, nophoneId))
    expect((await nophone.json(`/api/posts/${postId}`)).status).toBe(200)
  })
})
