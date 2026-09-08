import { strToU8, zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { becomeAdmin, consentTool, makeDeveloper, TestUser } from './helpers'

const admin = new TestUser('管理员授')
const dev = new TestUser('开发者授')
const owner = new TestUser('圈主授')
const member = new TestUser('成员授')
const quiet = new TestUser('沉默授')
let ownerId = ''
let memberId = ''
let quietId = ''
let circleId = ''

const SLUG = 'consent-tool'

function bundle(): Buffer {
  const manifest = {
    slug: SLUG,
    name: '授权测试工具',
    version: '1.0.0',
    description: '看成员和帖子',
    entry: 'index.html',
    permissions: ['user.profile', 'storage', 'members.read', 'posts.read'],
  }
  return Buffer.from(zipSync({ 'harth.json': strToU8(JSON.stringify(manifest)), 'index.html': strToU8('<h1>hi</h1>') }))
}

async function toolApi(token: string, path: string) {
  const { app } = await import('../src/app')
  const res = await app.request(`/api/tool${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  await seed()
  await becomeAdmin(admin, 'consent-admin@test.dev')
  await dev.signUp('consent-dev@test.dev')
  ownerId = await owner.signUp('consent-owner@test.dev')
  memberId = await member.signUp('consent-member@test.dev')
  quietId = await quiet.signUp('consent-quiet@test.dev')
  await makeDeveloper(admin, dev)
  for (const u of [owner, member, quiet]) await u.post('/api/circles/nuaa/join')
  const circle = await owner.post<{ circle: { id: string } }>('/api/circles', { name: '授权圈', visibility: 'public', parentIds: ['nuaa'] })
  circleId = circle.body.circle.id
  await member.post(`/api/circles/${circleId}/join`)
  await quiet.post(`/api/circles/${circleId}/join`)
  const zip = bundle()
  const published = await dev.json<{ version: { id: string } }>('/api/tools/publish', {
    method: 'POST',
    body: zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
    headers: { 'content-type': 'application/zip' },
  })
  expect(published.status).toBe(201)
  expect((await admin.post(`/api/tools/versions/${published.body.version.id}/review`, { decision: 'approve' })).status).toBe(200)
  expect((await owner.post(`/api/circles/${circleId}/tools/${SLUG}`)).status).toBe(201)
  await quiet.post(`/api/posts/circles/${circleId}`, { templateKey: 'discussion', fields: { title: '沉默者的帖子', body: '正文' } })
})

describe('工具数据授权', () => {
  it('第一次打开先看清单：428 带工具、开发者与权限', async () => {
    const res = await member.post<{ code: string; consent: { tool: { slug: string }; scopes: string[]; developer: { name: string } } }>(
      `/api/circles/${circleId}/tools/${SLUG}/token`,
    )
    expect(res.status).toBe(428)
    expect(res.body.code).toBe('CONSENT_REQUIRED')
    expect(res.body.consent.tool.slug).toBe(SLUG)
    expect(res.body.consent.scopes).toContain('members.read')
    expect(res.body.consent.developer.name).toBe('开发者授')
  })

  it('同意后拿到令牌；圈主安装不等于成员同意', async () => {
    expect((await owner.post(`/api/circles/${circleId}/tools/${SLUG}/token`)).status).toBe(428)
    await consentTool(member, circleId, SLUG)
    const res = await member.post<{ token: string }>(`/api/circles/${circleId}/tools/${SLUG}/token`)
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    const consents = await member.json<{ consents: { toolSlug: string; circleId: string; scopes: string[] }[] }>('/api/users/me/consents')
    expect(consents.body.consents).toMatchObject([{ toolSlug: SLUG, circleId }])
  })

  it('工具只看到同意过的成员；没同意的作者只剩占位', async () => {
    const token = (await member.post<{ token: string }>(`/api/circles/${circleId}/tools/${SLUG}/token`)).body.token
    const members = await toolApi(token, '/members')
    expect(members.status).toBe(200)
    const ids = (members.body.members as { id: string }[]).map((m) => m.id)
    expect(ids).toContain(memberId)
    expect(ids).not.toContain(ownerId)
    expect(ids).not.toContain(quietId)
    const posts = await toolApi(token, '/posts')
    const post = (posts.body.posts as { title: string; authorId: string | null; authorName: string }[]).find((p) => p.title === '沉默者的帖子')!
    expect(post.authorId).toBeNull()
    expect(post.authorName).toBe('成员')
    await consentTool(quiet, circleId, SLUG)
    const again = await toolApi(token, '/posts')
    expect((again.body.posts as { title: string; authorId: string | null }[]).find((p) => p.title === '沉默者的帖子')!.authorId).toBe(quietId)
  })

  it('撤回后旧令牌立即失效，再打开重新问', async () => {
    const token = (await member.post<{ token: string }>(`/api/circles/${circleId}/tools/${SLUG}/token`)).body.token
    expect((await member.delete(`/api/users/me/consents/${(await toolIdOf()) ?? ''}/${circleId}`)).status).toBe(200)
    const denied = await toolApi(token, '/members')
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('CONSENT_REQUIRED')
    expect((await member.post(`/api/circles/${circleId}/tools/${SLUG}/token`)).status).toBe(428)
    await consentTool(member, circleId, SLUG)
    expect((await member.post(`/api/circles/${circleId}/tools/${SLUG}/token`)).status).toBe(200)
  })
})

async function toolIdOf(): Promise<string | null> {
  const consents = await quiet.json<{ consents: { toolId: string; toolSlug: string }[] }>('/api/users/me/consents')
  return consents.body.consents.find((c) => c.toolSlug === SLUG)?.toolId ?? null
}
