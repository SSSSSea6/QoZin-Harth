import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { seed } from '../src/db/seed'
import { TestUser } from './helpers'

const alice = new TestUser('阿澄')
const bob = new TestUser('北野')
let aliceId = ''
let bobId = ''
let circleId = ''
let postId = ''

beforeAll(async () => {
  await seed()
  aliceId = await alice.signUp('alice@test.dev')
  bobId = await bob.signUp('bob@test.dev')
})

describe('账号与会话', () => {
  it('未登录访问业务接口返回 401', async () => {
    const res = await app.request('/api/circles/mine')
    expect(res.status).toBe(401)
  })
})

describe('圈子原语', () => {
  it('官方顶层身份圈可直接加入', async () => {
    const top = await alice.json<{ circles: { id: string }[] }>(
      '/api/circles/top',
    )
    expect(top.body.circles.map((c) => c.id)).toContain('nuaa')
    expect((await alice.post('/api/circles/nuaa/join')).status).toBe(201)
    expect((await bob.post('/api/circles/nuaa/join')).status).toBe(201)
  })

  it('在身份圈下创建公开社群圈（depth 2）', async () => {
    const { status, body } = await alice.post('/api/circles', {
      name: '骨架测试圈',
      visibility: 'public',
      parentIds: ['nuaa'],
    })
    expect(status).toBe(201)
    circleId = (body as { circle: { id: string } }).circle.id
  })

  it('父圈成员可加入公开子圈；发现页能看到它', async () => {
    const children = await bob.json<{ circles: { id: string }[] }>(
      '/api/circles/nuaa/children',
    )
    expect(children.body.circles.map((c) => c.id)).toContain(circleId)
    expect((await bob.post(`/api/circles/${circleId}/join`)).status).toBe(201)
  })

  it('嵌套上限：第 3 层可建，第 4 层被拒', async () => {
    const l3 = await alice.post('/api/circles', {
      name: '行动小圈',
      visibility: 'public',
      parentIds: [circleId],
    })
    expect(l3.status).toBe(201)
    const l3id = (l3.body as { circle: { id: string } }).circle.id

    const l4 = await alice.post('/api/circles', {
      name: '超深圈',
      visibility: 'public',
      parentIds: [l3id],
    })
    expect(l4.status).toBe(400)
    expect((l4.body as { error: string }).error).toContain('3 层')
  })

  it('非父圈成员看不到、也进不去作用域内的公开圈', async () => {
    const stranger = new TestUser('路人')
    await stranger.signUp('stranger@test.dev')
    const detail = await stranger.json(`/api/circles/${circleId}`)
    expect(detail.status).toBe(404)
    const join = await stranger.post(`/api/circles/${circleId}/join`)
    expect(join.status).toBe(403)
  })

  it('圈内发讨论帖并回复；列表带回复数', async () => {
    const created = await alice.post(`/api/posts/circles/${circleId}`, {
      templateKey: 'discussion',
      fields: { title: '这个圈子点火了', body: '欢迎来烤火' },
    })
    expect(created.status).toBe(201)
    const id = (created.body as { post: { id: string } }).post.id

    const replied = await bob.post(`/api/posts/${id}/comments`, {
      content: '坐下坐下',
    })
    expect(replied.status).toBe(201)

    const detail = await bob.json<{
      post: { comments: { content: string }[]; circleName: string }
    }>(`/api/posts/${id}`)
    expect(detail.body.post.comments[0]?.content).toBe('坐下坐下')
    expect(detail.body.post.circleName).toBe('骨架测试圈')

    const list = await bob.json<{
      posts: { id: string; commentCount: number }[]
    }>(`/api/posts/circles/${circleId}`)
    expect(list.body.posts.find((p) => p.id === id)?.commentCount).toBe(1)
  })

  it('讨论帖缺标题被拒', async () => {
    const res = await alice.post(`/api/posts/circles/${circleId}`, {
      templateKey: 'discussion',
      fields: { body: '没有标题' },
    })
    expect(res.status).toBe(400)
  })

  it('聊天消息仅限双人圈，群圈拒收', async () => {
    const res = await alice.post(`/api/circles/${circleId}/messages`, {
      content: '这里不该有聊天',
    })
    expect(res.status).toBe(400)
  })

  it('聚合信息流只含我所在圈子的帖子', async () => {
    const outsider = new TestUser('圈外人')
    await outsider.signUp('outsider@test.dev')
    await outsider.post('/api/circles/nuaa/join')

    const mine = await bob.json<{ posts: { circleId: string }[] }>(
      '/api/posts/feed',
    )
    expect(mine.body.posts.some((p) => p.circleId === circleId)).toBe(true)

    const theirs = await outsider.json<{ posts: { circleId: string }[] }>(
      '/api/posts/feed',
    )
    expect(theirs.body.posts.some((p) => p.circleId === circleId)).toBe(false)
  })
})

describe('二手模板全流程', () => {
  it('圈主启用二手能力（非圈主被拒）', async () => {
    const denied = await bob.put(
      `/api/circles/${circleId}/templates/secondhand`,
      { enabled: true },
    )
    expect(denied.status).toBe(403)
    const ok = await alice.put(
      `/api/circles/${circleId}/templates/secondhand`,
      { enabled: true },
    )
    expect(ok.status).toBe(200)
  })

  it('发布 → 应答 → 选定 → 双方确认 → 互评', async () => {
    const created = await alice.post(`/api/posts/circles/${circleId}`, {
      templateKey: 'secondhand',
      fields: { title: '高数教材（下）', description: '九成新', priceFen: 0 },
    })
    expect(created.status).toBe(201)
    postId = (created.body as { post: { id: string } }).post.id

    const responded = await bob.post(`/api/posts/${postId}/responses`, {
      message: '正好需要，晚上宿舍楼下取？',
    })
    expect(responded.status).toBe(201)
    const dup = await bob.post(`/api/posts/${postId}/responses`, {
      message: '再发一次',
    })
    expect(dup.status).toBe(409)

    const detail = await alice.json<{
      post: { responses: { id: string }[] }
    }>(`/api/posts/${postId}`)
    const responseId = detail.body.post.responses[0]!.id

    expect(
      (await alice.post(`/api/posts/${postId}/accept`, { responseId })).status,
    ).toBe(200)

    const c1 = await alice.post(`/api/posts/${postId}/confirm`)
    expect((c1.body as { status: string }).status).toBe('matched')
    const c2 = await bob.post(`/api/posts/${postId}/confirm`)
    expect((c2.body as { status: string }).status).toBe('completed')

    expect(
      (
        await alice.post(`/api/posts/${postId}/reviews`, {
          rating: 5,
          comment: '爽快',
        })
      ).status,
    ).toBe(201)
    expect(
      (await bob.post(`/api/posts/${postId}/reviews`, { rating: 4 })).status,
    ).toBe(201)
  })

  it('互评落进个人信誉', async () => {
    const profile = await bob.json<{
      profile: {
        reputation: { reviewCount: number; completedCount: number }
      }
    }>(`/api/users/${aliceId}/profile`)
    expect(profile.body.profile.reputation.reviewCount).toBe(1)
    expect(profile.body.profile.reputation.completedCount).toBe(1)
  })
})

describe('生命周期：沉寂 → 倒计时 → 添柴 / 归档', () => {
  it('沉寂的圈被巡查置入休眠倒计时', async () => {
    const past = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString()
    await alice.post('/api/test/circle-times', {
      circleId,
      lastActivityAt: past,
    })
    const sweep = await alice.post('/api/test/sweep')
    expect((sweep.body as { hibernated: number }).hibernated).toBeGreaterThan(0)
    const detail = await alice.json<{
      circle: { lifecycle: { state: string } }
    }>(`/api/circles/${circleId}`)
    expect(detail.body.circle.lifecycle.state).toBe('hibernating')
  })

  it('任一成员添柴即解除倒计时', async () => {
    expect((await bob.post(`/api/circles/${circleId}/renew`)).status).toBe(200)
    const detail = await bob.json<{
      circle: { lifecycle: { state: string } }
    }>(`/api/circles/${circleId}`)
    expect(detail.body.circle.lifecycle.state).toBe('active')
  })

  it('倒计时到期无人添柴则静默归档，圈子只读', async () => {
    const past = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString()
    const pastDeadline = new Date(Date.now() - 1000).toISOString()
    await alice.post('/api/test/circle-times', {
      circleId,
      lastActivityAt: past,
      hibernationDeadline: pastDeadline,
    })
    const sweep = await alice.post('/api/test/sweep')
    expect((sweep.body as { archived: number }).archived).toBeGreaterThan(0)

    const detail = await alice.json<{
      circle: { lifecycle: { state: string } }
    }>(`/api/circles/${circleId}`)
    expect(detail.body.circle.lifecycle.state).toBe('archived')

    const write = await alice.post(`/api/posts/circles/${circleId}`, {
      templateKey: 'discussion',
      fields: { title: '还能说话吗', body: '' },
    })
    expect(write.status).toBe(409)

    const read = await alice.json<{ posts: unknown[] }>(
      `/api/posts/circles/${circleId}`,
    )
    expect(read.status).toBe(200)
    expect(read.body.posts.length).toBeGreaterThan(0)
  })

  it('归档不影响已沉淀的信誉', async () => {
    const profile = await alice.json<{
      profile: { reputation: { reviewCount: number } }
    }>(`/api/users/${bobId}/profile`)
    expect(profile.body.profile.reputation.reviewCount).toBe(1)
  })
})

describe('双人圈', () => {
  it('创建即会话，重复创建返回同一个圈', async () => {
    const first = await alice.post('/api/circles/dm', { userId: bobId })
    expect(first.status).toBe(201)
    const dmId = (first.body as { circle: { id: string } }).circle.id

    const again = await bob.post('/api/circles/dm', { userId: aliceId })
    expect((again.body as { circle: { id: string } }).circle.id).toBe(dmId)

    const sent = await alice.post(`/api/circles/${dmId}/messages`, {
      content: '书带来了',
    })
    expect(sent.status).toBe(201)

    const detail = await bob.json<{
      circle: { isDm: boolean; name: string }
    }>(`/api/circles/${dmId}`)
    expect(detail.body.circle.isDm).toBe(true)
    expect(detail.body.circle.name).toBe('阿澄')
  })
})
