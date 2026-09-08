import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { seed } from '../src/db/seed'
import { becomeAdmin, TestUser } from './helpers'

const admin = new TestUser('管理员治')
const alice = new TestUser('阿治')
const bob = new TestUser('鲍治')
const carol = new TestUser('卡治')
let adminId = ''
let aliceId = ''
let bobId = ''
let circleId = ''
let postId = ''
let commentId = ''
let dmId = ''

type Err = { error: string; code?: string }

async function listFeed(user: TestUser): Promise<string[]> {
  const { body } = await user.json<{ posts: { id: string }[] }>('/api/posts/feed')
  return body.posts.map((p) => p.id)
}

beforeAll(async () => {
  await seed()
  adminId = await becomeAdmin(admin, 'gov-admin@test.dev')
  aliceId = await alice.signUp('gov-alice@test.dev')
  bobId = await bob.signUp('gov-bob@test.dev')
  await carol.signUp('gov-carol@test.dev')
  for (const u of [admin, alice, bob, carol]) await u.post('/api/circles/nuaa/join')
  const circle = await alice.post<{ circle: { id: string } }>('/api/circles', { name: '治理圈', visibility: 'public', parentIds: ['nuaa'] })
  circleId = circle.body.circle.id
  for (const u of [admin, bob, carol]) await u.post(`/api/circles/${circleId}/join`)
  const post = await bob.post<{ post: { id: string } }>(`/api/posts/circles/${circleId}`, {
    templateKey: 'discussion',
    fields: { title: '鲍治的帖子', body: '正文' },
  })
  postId = post.body.post.id
  const comment = await bob.post<{ comment: { id: string } }>(`/api/posts/${postId}/comments`, { content: '鲍治的回复' })
  commentId = comment.body.comment.id
  const dm = await alice.post<{ circle: { id: string } }>('/api/circles/dm', { userId: bobId })
  dmId = dm.body.circle.id
})

describe('举报', () => {
  it('只能举报看得到的对象，不能举报自己，同目标只有一条待处理', async () => {
    const stranger = new TestUser('圈外治')
    await stranger.signUp('gov-stranger@test.dev')
    expect((await stranger.post('/api/reports', { targetType: 'post', targetId: postId, reason: 'spam' })).status).toBe(404)
    expect((await bob.post('/api/reports', { targetType: 'post', targetId: postId, reason: 'spam' })).status).toBe(400)
    const first = await alice.post('/api/reports', { targetType: 'post', targetId: postId, reason: 'spam', detail: '刷屏' })
    expect(first.status).toBe(201)
    expect((await alice.post('/api/reports', { targetType: 'post', targetId: postId, reason: 'abuse' })).status).toBe(409)
    const mine = await alice.json<{ reports: { status: string }[] }>('/api/reports/mine')
    expect(mine.body.reports.map((r) => r.status)).toContain('pending')
  })

  it('普通成员进不了管理接口', async () => {
    expect((await alice.json('/api/admin/reports')).status).toBe(403)
  })

  it('管理员隐藏帖子：信息流不再出现，详情只剩占位，作者看到原因', async () => {
    const queue = await admin.json<{ reports: { id: string; targetId: string; snapshot: string; reporterName: string }[] }>('/api/admin/reports')
    const report = queue.body.reports.find((r) => r.targetId === postId)!
    expect(report.snapshot).toBe('鲍治的帖子')
    const evidence = await admin.json<{ target: { text: string } }>(`/api/admin/reports/${report.id}/evidence`)
    expect(evidence.body.target.text).toContain('正文')
    const decided = await admin.post<{ moderationId: string }>(`/api/admin/reports/${report.id}/decide`, { action: 'hide', reason: '广告' })
    expect(decided.status).toBe(200)
    expect((await admin.post(`/api/admin/reports/${report.id}/decide`, { action: 'dismiss', reason: '重复' })).status).toBe(409)

    expect(await listFeed(carol)).not.toContain(postId)
    const detail = await carol.json<{ post: { hidden?: boolean; title?: string } }>(`/api/posts/${postId}`)
    expect(detail.body.post.hidden).toBe(true)
    expect(detail.body.post.title).toBeUndefined()
    const own = await bob.json<{ post: { hidden: boolean; hiddenReason: string | null; title: string } }>(`/api/posts/${postId}`)
    expect(own.body.post.title).toBe('鲍治的帖子')
    expect(own.body.post.hiddenReason).toBe('广告')
    const asReporter = await alice.json<{ reports: { status: string }[] }>('/api/reports/mine')
    expect(asReporter.body.reports[0]!.status).toBe('handled')
  })

  it('被处置的人看到记录、申诉一次；接受申诉只撤销那一条', async () => {
    const mine = await bob.json<{ moderations: { id: string; action: string; reversed: boolean }[] }>('/api/appeals/mine')
    const hide = mine.body.moderations.find((m) => m.action === 'hide')!
    expect(hide.reversed).toBe(false)
    expect((await alice.post('/api/appeals', { moderationId: hide.id, text: '不是广告' })).status).toBe(404)
    expect((await bob.post('/api/appeals', { moderationId: hide.id, text: '这是圈里的团购信息' })).status).toBe(201)
    expect((await bob.post('/api/appeals', { moderationId: hide.id, text: '再来一次' })).status).toBe(409)

    const queue = await admin.json<{ appeals: { id: string; moderationId: string; userName: string }[] }>('/api/admin/appeals')
    const appeal = queue.body.appeals.find((a) => a.moderationId === hide.id)!
    expect(appeal.userName).toBe('鲍治')
    expect((await admin.post(`/api/admin/appeals/${appeal.id}/decide`, { accept: true, note: '确认是团购' })).status).toBe(200)
    expect((await admin.post(`/api/admin/appeals/${appeal.id}/decide`, { accept: false, note: '再驳' })).status).toBe(409)
    expect(await listFeed(carol)).toContain(postId)
    const after = await bob.json<{ moderations: { id: string; reversed: boolean; appealStatus: string }[] }>('/api/appeals/mine')
    expect(after.body.moderations.find((m) => m.id === hide.id)).toMatchObject({ reversed: true, appealStatus: 'accepted' })
  })

  it('禁言经举报生效并能撤销，撤销不影响后来的处罚', async () => {
    const report = await carol.post<{ id: string }>('/api/reports', { targetType: 'comment', targetId: commentId, reason: 'abuse' })
    expect(report.status).toBe(201)
    const decided = await admin.post<{ moderationId: string }>(`/api/admin/reports/${report.body.id}/decide`, { action: 'mute', reason: '骂人', days: 7 })
    expect(decided.status).toBe(200)
    const muted = await bob.post<Err>(`/api/posts/${postId}/comments`, { content: '还想说' })
    expect(muted.status).toBe(403)
    expect(muted.body.code).toBe('MUTED')
    expect((await bob.post('/api/reports', { targetType: 'user', targetId: aliceId, reason: 'other' })).status).toBe(201)

    const again = await alice.post<{ id: string }>('/api/reports', { targetType: 'comment', targetId: commentId, reason: 'spam' })
    const second = await admin.post<{ moderationId: string }>(`/api/admin/reports/${again.body.id}/decide`, { action: 'mute', reason: '再犯', days: 30 })
    expect((await admin.post(`/api/admin/moderations/${decided.body.moderationId}/reverse`, { reason: '第一次误判' })).status).toBe(200)
    const still = await bob.post<Err>(`/api/posts/${postId}/comments`, { content: '解禁了吗' })
    expect(still.body.code).toBe('MUTED')
    expect((await admin.post(`/api/admin/moderations/${second.body.moderationId}/reverse`, { reason: '也撤了' })).status).toBe(200)
    expect((await bob.post(`/api/posts/${postId}/comments`, { content: '解禁了' })).status).toBe(201)
  })

  it('封禁后只剩申诉、导出、注销；解封恢复', async () => {
    const report = await alice.post<{ id: string }>('/api/reports', { targetType: 'user', targetId: bobId, reason: 'illegal' })
    const decided = await admin.post<{ moderationId: string }>(`/api/admin/reports/${report.body.id}/decide`, { action: 'ban', reason: '严重违规' })
    expect(decided.status).toBe(200)
    const read = await bob.json<Err>(`/api/posts/${postId}`)
    expect(read.status).toBe(403)
    expect(read.body.code).toBe('BANNED')
    const session = await bob.json<{ user: { restriction: { kind: string; reason: string } | null } }>('/api/auth/get-session')
    expect(session.body.user.restriction).toMatchObject({ kind: 'ban', reason: '严重违规' })
    expect((await bob.json('/api/appeals/mine')).status).toBe(200)
    expect((await bob.req('/api/users/me/export')).status).toBe(200)
    expect((await admin.post(`/api/admin/moderations/${decided.body.moderationId}/reverse`, { reason: '申诉通过' })).status).toBe(200)
    expect((await bob.json(`/api/posts/${postId}`)).status).toBe(200)
  })
})

describe('屏蔽', () => {
  it('屏蔽后对方的内容不出现，双向不能私聊，解除后恢复', async () => {
    expect((await carol.put(`/api/users/${carolId()}/block`, {})).status).toBe(400)
    expect((await carol.put(`/api/users/${bobId}/block`, {})).status).toBe(200)
    expect(await listFeed(carol)).not.toContain(postId)
    const detail = await carol.json<{ post: { comments: { id: string }[] } }>(`/api/posts/${postId}`)
    expect(detail.body.post.comments.map((c) => c.id)).not.toContain(commentId)
    const dm = await carol.post<Err>('/api/circles/dm', { userId: bobId })
    expect(dm.status).toBe(403)
    expect(dm.body.code).toBe('BLOCKED')
    const reverse = await bob.post<Err>('/api/circles/dm', { userId: carolId() })
    expect(reverse.body.code).toBe('BLOCKED')
    const blocks = await carol.json<{ blocks: { id: string }[] }>('/api/users/me/blocks')
    expect(blocks.body.blocks.map((b) => b.id)).toEqual([bobId])
    expect((await carol.delete(`/api/users/${bobId}/block`)).status).toBe(200)
    expect(await listFeed(carol)).toContain(postId)
  })

  it('已有私聊里，一方屏蔽后另一方也发不出消息，历史保留', async () => {
    expect((await bob.put(`/api/users/${aliceId}/block`, {})).status).toBe(200)
    const blocked = await alice.post<Err>(`/api/circles/${dmId}/messages`, { content: '在吗' })
    expect(blocked.body.code).toBe('BLOCKED')
    expect((await bob.post(`/api/circles/${dmId}/messages`, { content: '我也发不了' })).status).toBe(403)
    expect((await alice.json(`/api/circles/${dmId}/messages`)).status).toBe(200)
    await bob.delete(`/api/users/${aliceId}/block`)
    expect((await alice.post(`/api/circles/${dmId}/messages`, { content: '好了' })).status).toBe(201)
  })
})

describe('内容规则与巡查', () => {
  it('reject 规则直接拒绝，flag 规则自动进举报队列', async () => {
    const reject = await admin.post<{ rule: { id: string } }>('/api/admin/rules', { pattern: '代开发票', kind: 'reject' })
    expect(reject.status).toBe(201)
    const flag = await admin.post<{ rule: { id: string } }>('/api/admin/rules', { pattern: '加微信', kind: 'flag', note: '可能是广告' })
    const refused = await alice.post<Err>(`/api/posts/${postId}/comments`, { content: '专业代开发票' })
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('CONTENT_REJECTED')
    const renamed = await alice.post<{ code?: string }>('/api/auth/update-user', { name: '代开发票小助手' })
    expect(renamed.status).toBe(400)
    const flagged = await alice.post<{ comment: { id: string } }>(`/api/posts/${postId}/comments`, { content: '有意的加微信聊' })
    expect(flagged.status).toBe(201)
    const queue = await admin.json<{ reports: { targetId: string; reason: string; reporterName: string | null }[] }>('/api/admin/reports')
    expect(queue.body.reports.find((r) => r.targetId === flagged.body.comment.id)).toMatchObject({ reason: 'rule', reporterName: null })
    expect((await admin.delete(`/api/admin/rules/${reject.body.rule.id}`)).status).toBe(200)
    expect((await admin.delete(`/api/admin/rules/${flag.body.rule.id}`)).status).toBe(200)
    expect((await alice.post(`/api/posts/${postId}/comments`, { content: '代开发票' })).status).toBe(201)
  })

  it('巡查面板列出最近内容', async () => {
    const content = await admin.json<{ posts: { id: string }[]; comments: { id: string }[] }>('/api/admin/content')
    expect(content.body.posts.map((p) => p.id)).toContain(postId)
    expect(content.body.comments.map((c) => c.id)).toContain(commentId)
  })
})

function carolId(): string {
  return carolIdValue
}
let carolIdValue = ''
beforeAll(async () => {
  const { body } = await carol.json<{ user: { id: string } }>('/api/auth/get-session')
  carolIdValue = body.user.id
})

describe('接口守卫', () => {
  it('未登录一律 401', async () => {
    expect((await app.request('/api/reports/mine')).status).toBe(401)
    expect((await app.request('/api/admin/reports')).status).toBe(401)
  })
  it('管理员不能处置自己', async () => {
    const report = await alice.post<{ id: string }>('/api/reports', { targetType: 'user', targetId: adminId, reason: 'other' })
    expect(report.status).toBe(201)
    const decided = await admin.post(`/api/admin/reports/${report.body.id}/decide`, { action: 'ban', reason: '试试' })
    expect(decided.status).toBe(400)
    expect((await admin.post(`/api/admin/reports/${report.body.id}/decide`, { action: 'dismiss', reason: '没事' })).status).toBe(200)
  })
})
