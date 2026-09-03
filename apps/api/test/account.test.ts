import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { user } from '../src/db/auth-schema'
import { circles } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { TestUser } from './helpers'

const carol = new TestUser('可心')
const dave = new TestUser('大卫')
let carolId = ''
let daveId = ''
let circleId = ''
let soloCircleId = ''
let dmId = ''
let postId = ''
let itemId = ''

async function createCircle(u: TestUser, name: string): Promise<string> {
  const { body } = await u.post<{ circle: { id: string } }>('/api/circles', {
    name,
    visibility: 'public',
    parentIds: ['nuaa'],
  })
  return body.circle.id
}

beforeAll(async () => {
  await seed()
  carolId = await carol.signUp('carol@test.dev')
  daveId = await dave.signUp('dave@test.dev')
  await carol.post('/api/circles/nuaa/join')
  await dave.post('/api/circles/nuaa/join')
  circleId = await createCircle(carol, '可心的圈')
  soloCircleId = await createCircle(carol, '只有可心')
  await dave.post(`/api/circles/${circleId}/join`)

  const post = await carol.post<{ post: { id: string } }>(`/api/posts/circles/${circleId}`, {
    templateKey: 'discussion',
    fields: { title: '注销前的帖子', body: '内容留着' },
  })
  postId = post.body.post.id
  await dave.post(`/api/posts/${postId}/comments`, { content: '大卫的回复' })

  await carol.put(`/api/circles/${circleId}/templates/secondhand`, { enabled: true })
  const item = await carol.post<{ post: { id: string } }>(`/api/posts/circles/${circleId}`, {
    templateKey: 'secondhand',
    fields: { title: '旧台灯', description: '', priceFen: 0 },
  })
  itemId = item.body.post.id

  const dm = await carol.post<{ circle: { id: string } }>('/api/circles/dm', { userId: daveId })
  dmId = dm.body.circle.id
})

describe('数据导出', () => {
  it('下载的 JSON 包含账号、圈子、帖子、回复与登录记录', async () => {
    const res = await carol.req('/api/users/me/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const data = (await res.json()) as {
      user: { email: string }
      sessions: unknown[]
      circles: { id: string; role: string }[]
      posts: { id: string }[]
    }
    expect(data.user.email).toBe('carol@test.dev')
    expect(data.sessions.length).toBeGreaterThan(0)
    expect(data.circles.find((c) => c.id === circleId)?.role).toBe('owner')
    expect(data.posts.map((p) => p.id).sort()).toEqual([postId, itemId].sort())
  })
})

describe('账号注销', () => {
  it('密码不对不注销', async () => {
    expect((await carol.post('/api/users/me/delete', { password: 'wrong' })).status).toBe(403)
    expect((await carol.json('/api/circles/mine')).status).toBe(200)
  })

  it('注销后会话失效、不能再登录、个人信息被抹去', async () => {
    expect((await carol.post('/api/users/me/delete', { password: 'password-123' })).status).toBe(200)
    expect((await carol.req('/api/circles/mine')).status).toBe(401)
    const login = await carol.post('/api/auth/sign-in/email', {
      email: 'carol@test.dev',
      password: 'password-123',
    })
    expect(login.status).toBeGreaterThanOrEqual(400)
    const [row] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, carolId))
    expect(row?.name).toBe('已注销用户')
    expect(row?.email).not.toContain('carol@test.dev')
  })

  it('内容匿名保留，圈主交接，独自的圈与双人圈归档，进行中的二手帖取消', async () => {
    const detail = await dave.json<{ post: { author: { name: string }; comments: { content: string }[] } }>(
      `/api/posts/${postId}`,
    )
    expect(detail.body.post.author.name).toBe('已注销用户')
    expect(detail.body.post.comments.map((c) => c.content)).toEqual(['大卫的回复'])

    const members = await dave.json<{ members: { id: string; role: string }[] }>(`/api/circles/${circleId}/members`)
    expect(members.body.members).toEqual([{ id: daveId, role: 'owner' }].map((m) => expect.objectContaining(m)))

    const item = await dave.json<{ post: { status: string } }>(`/api/posts/${itemId}`)
    expect(item.body.post.status).toBe('cancelled')

    const dm = await dave.json<{ circle: { lifecycle: { state: string } } }>(`/api/circles/${dmId}`)
    expect(dm.body.circle.lifecycle.state).toBe('archived')

    const [solo] = await db.select({ archivedAt: circles.archivedAt }).from(circles).where(eq(circles.id, soloCircleId))
    expect(solo?.archivedAt).not.toBeNull()
  })
})
