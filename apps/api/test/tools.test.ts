import { strToU8, zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { seed } from '../src/db/seed'
import { TestUser } from './helpers'

const admin = new TestUser('管理员')
const dev = new TestUser('开发者')
const owner = new TestUser('圈主')
const member = new TestUser('成员')
let circleA = ''
let circleB = ''
let versionId = ''
let tokenA = ''

const manifest = {
  slug: 'roll-call',
  name: '点名',
  version: '1.0.0',
  description: '测试用的工具',
  permissions: ['user.profile', 'storage', 'members.read'],
}

function pack(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
}

function bundle(extraHtml = ''): Uint8Array {
  return pack({
    'harth.json': JSON.stringify(manifest),
    'index.html': `<!doctype html><script src="/_harth/sdk.js"></script><p>点名</p>${extraHtml}`,
  })
}

async function publish(user: TestUser, zip: Uint8Array) {
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
  return user.json<{ version: { id: string; status: string; review: { checks: { name: string; ok: boolean }[] } }; error?: string }>(
    '/api/tools/publish',
    { method: 'POST', body, headers: { 'content-type': 'application/zip' } },
  )
}

async function toolApi(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init.body) headers.set('content-type', 'application/json')
  const res = await app.request(`/api/tool${path}`, { ...init, headers })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function createCircle(user: TestUser, name: string): Promise<string> {
  const { body } = await user.post('/api/circles', { name, visibility: 'public', parentIds: ['nuaa'] })
  return (body as { circle: { id: string } }).circle.id
}

beforeAll(async () => {
  await seed()
  await admin.signUp('admin@test.dev')
  await dev.signUp('dev@test.dev')
  await owner.signUp('owner@test.dev')
  await member.signUp('member@test.dev')
  for (const u of [owner, member, dev]) await u.post('/api/circles/nuaa/join')
  circleA = await createCircle(owner, '圈 A')
  circleB = await createCircle(owner, '圈 B')
  await member.post(`/api/circles/${circleA}/join`)
})

describe('发布与审核', () => {
  it('引用站外资源的包直接拒绝', async () => {
    const { status, body } = await publish(dev, bundle('<script src="https://cdn.example.com/x.js"></script>'))
    expect(status).toBe(201)
    expect(body.version.status).toBe('rejected')
    expect(body.version.review.checks.find((c) => c.name === '外部资源')?.ok).toBe(false)
  })

  it('同一版本号不能再发', async () => {
    const { status } = await publish(dev, bundle())
    expect(status).toBe(409)
  })

  it('合规的包进入待审', async () => {
    const { status, body } = await publish(dev, pack({
      'harth.json': JSON.stringify({ ...manifest, version: '1.0.1' }),
      'index.html': '<!doctype html><script src="/_harth/sdk.js"></script><p>点名</p>',
    }))
    expect(status).toBe(201)
    expect(body.version.status).toBe('pending')
    versionId = body.version.id
  })

  it('没上架的工具装不了，市场里也看不到', async () => {
    expect((await owner.post(`/api/circles/${circleA}/tools/roll-call`)).status).toBe(404)
    const market = await owner.json<{ tools: { slug: string }[] }>('/api/tools')
    expect(market.body.tools.find((t) => t.slug === 'roll-call')).toBeUndefined()
  })

  it('只有管理员能审核，通过后上架', async () => {
    expect((await dev.post(`/api/tools/versions/${versionId}/review`, { decision: 'approve' })).status).toBe(403)
    const { status, body } = await admin.post(`/api/tools/versions/${versionId}/review`, { decision: 'approve' })
    expect(status).toBe(200)
    expect((body as { version: { status: string } }).version.status).toBe('approved')
    const market = await owner.json<{ tools: { slug: string; version: string }[] }>('/api/tools')
    expect(market.body.tools.find((t) => t.slug === 'roll-call')?.version).toBe('1.0.1')
  })

  it('别人不能用同一个 slug', async () => {
    const { status } = await publish(owner, pack({
      'harth.json': JSON.stringify({ ...manifest, version: '2.0.0' }),
      'index.html': '<p>x</p>',
    }))
    expect(status).toBe(403)
  })
})

describe('安装与令牌', () => {
  it('圈主安装，成员拿到带权限的令牌，非成员不行', async () => {
    expect((await member.post(`/api/circles/${circleA}/tools/roll-call`)).status).toBe(403)
    expect((await owner.post(`/api/circles/${circleA}/tools/roll-call`)).status).toBe(201)
    const list = await member.json<{ tools: { slug: string; scopes: string[] }[] }>(`/api/circles/${circleA}/tools`)
    expect(list.body.tools.map((t) => t.slug)).toEqual(['roll-call'])

    const token = await member.post<{ token: string; context: { scopes: string[]; entryUrl: string } }>(
      `/api/circles/${circleA}/tools/roll-call/token`,
    )
    expect(token.status).toBe(200)
    expect(token.body.context.scopes).toEqual(manifest.permissions)
    expect(token.body.context.entryUrl).toContain('/t/roll-call/')
    tokenA = token.body.token

    expect((await dev.post(`/api/circles/${circleA}/tools/roll-call/token`)).status).toBe(403)
  })

  it('存储按工具 × 圈隔离，并有乐观并发', async () => {
    const first = await toolApi(tokenA, '/storage/count', { method: 'PUT', body: JSON.stringify({ value: { n: 1 } }) })
    expect(first.status).toBe(200)
    expect((first.body.item as { version: number }).version).toBe(1)

    const stale = await toolApi(tokenA, '/storage/count', {
      method: 'PUT',
      body: JSON.stringify({ value: { n: 2 }, expectedVersion: 5 }),
    })
    expect(stale.status).toBe(409)

    const ok = await toolApi(tokenA, '/storage/count', {
      method: 'PUT',
      body: JSON.stringify({ value: { n: 2 }, expectedVersion: 1 }),
    })
    expect((ok.body.item as { version: number }).version).toBe(2)

    const listed = await toolApi(tokenA, '/storage?prefix=co')
    expect((listed.body.items as { key: string }[]).map((i) => i.key)).toEqual(['count'])

    await owner.post(`/api/circles/${circleB}/tools/roll-call`)
    const tokenB = (await owner.post<{ token: string }>(`/api/circles/${circleB}/tools/roll-call/token`)).body.token
    expect((await toolApi(tokenB, '/storage/count')).status).toBe(404)
  })

  it('接口按清单里的权限放行', async () => {
    expect((await toolApi(tokenA, '/members')).status).toBe(200)
    expect((await toolApi(tokenA, '/posts')).status).toBe(403)
    expect((await toolApi(tokenA, '/circle')).status).toBe(403)
    expect((await toolApi('not-a-token', '/members')).status).toBe(401)
  })

  it('工具页面由平台托管并带 CSP', async () => {
    const page = await app.request('/t/roll-call/')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('content-security-policy')).toContain('frame-ancestors')
    expect(await page.text()).toContain('点名')
    expect((await app.request('/t/roll-call/nope.js')).status).toBe(404)
    const sdk = await app.request('/_harth/sdk.js')
    expect(sdk.status).toBe(200)
    expect(sdk.headers.get('content-type')).toContain('javascript')
  })

  it('卸载后令牌失效，数据清空', async () => {
    expect((await owner.delete(`/api/circles/${circleA}/tools/roll-call`)).status).toBe(200)
    expect((await toolApi(tokenA, '/storage/count')).status).toBe(403)
    await owner.post(`/api/circles/${circleA}/tools/roll-call`)
    const fresh = (await member.post<{ token: string }>(`/api/circles/${circleA}/tools/roll-call/token`)).body.token
    expect((await toolApi(fresh, '/storage/count')).status).toBe(404)
  })
})

describe('本地开发会话', () => {
  it('登记后可在圈内以 _dev 打开，结束后令牌失效', async () => {
    await dev.post(`/api/circles/${circleA}/join`)
    const put = await dev.put<{ openUrl: string }>('/api/tools/dev-session', {
      circleId: circleA,
      url: 'http://localhost:3102',
      manifest: { ...manifest, slug: 'my-dev-tool', name: '开发中' },
    })
    expect(put.status).toBe(200)
    expect(put.body.openUrl).toContain(`/c/${circleA}/t/_dev`)

    const list = await dev.json<{ dev: { slug: string; name: string } | null }>(`/api/circles/${circleA}/tools`)
    expect(list.body.dev?.name).toBe('开发中')
    expect((await member.json<{ dev: unknown }>(`/api/circles/${circleA}/tools`)).body.dev).toBeNull()

    const token = await dev.post<{ token: string; context: { entryUrl: string } }>(`/api/circles/${circleA}/tools/_dev/token`)
    expect(token.status).toBe(200)
    expect(token.body.context.entryUrl).toBe('http://localhost:3102/index.html')
    const saved = await toolApi(token.body.token, '/storage/x', { method: 'PUT', body: JSON.stringify({ value: 1 }) })
    expect(saved.status).toBe(200)

    expect((await dev.delete('/api/tools/dev-session')).status).toBe(200)
    expect((await toolApi(token.body.token, '/storage/x')).status).toBe(403)
  })
})

interface ReviewItem {
  id: string
  version: string
  status: string
  review: { decidedBy?: string }
  tool: { slug: string }
  developer: { name: string }
  permissions: string[]
}

const ofRollCall = (items: ReviewItem[]) => items.filter((v) => v.tool.slug === 'roll-call')

async function marketVersion(): Promise<string | undefined> {
  const market = await owner.json<{ tools: { slug: string; version: string }[] }>('/api/tools')
  return market.body.tools.find((t) => t.slug === 'roll-call')?.version
}

describe('审核页接口', () => {
  let pendingId = ''

  it('队列只有管理员能看，待审与已处理分开', async () => {
    const published = await publish(dev, pack({
      'harth.json': JSON.stringify({ ...manifest, version: '1.0.2' }),
      'index.html': '<!doctype html><script src="/_harth/sdk.js"></script><p>点名 v2</p>',
    }))
    expect(published.body.version.status).toBe('pending')
    pendingId = published.body.version.id

    expect((await dev.json('/api/tools/review')).status).toBe(403)
    const { status, body } = await admin.json<{ pending: ReviewItem[]; recent: ReviewItem[] }>('/api/tools/review')
    expect(status).toBe(200)
    const pending = ofRollCall(body.pending)
    expect(pending.map((v) => v.version)).toEqual(['1.0.2'])
    expect(pending[0]?.developer.name).toBe('开发者')
    expect(pending[0]?.permissions).toEqual(manifest.permissions)
    expect(ofRollCall(body.recent).map((v) => [v.version, v.review.decidedBy])).toEqual([['1.0.1', 'admin'], ['1.0.0', 'checks']])
  })

  it('详情与文件：开发者和管理员能看，别人当不存在', async () => {
    const detail = await admin.json<{ developer: { name: string }; manifest: { permissions: string[] }; isCurrent: boolean }>(
      `/api/tools/versions/${pendingId}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.developer.name).toBe('开发者')
    expect(detail.body.manifest.permissions).toEqual(manifest.permissions)
    expect(detail.body.isCurrent).toBe(false)

    const files = await admin.json<{ files: { name: string; size: number; text?: string }[]; truncated: boolean }>(
      `/api/tools/versions/${pendingId}/files`,
    )
    expect(files.body.files.map((f) => f.name)).toEqual(['harth.json', 'index.html'])
    expect(files.body.files[1]?.text).toContain('点名 v2')
    expect(files.body.truncated).toBe(false)
    expect((await dev.json(`/api/tools/versions/${pendingId}/files`)).status).toBe(200)
    expect((await member.json(`/api/tools/versions/${pendingId}/files`)).status).toBe(404)
  })

  it('试运行：管理员在自己所在的圈里拿到令牌，未安装也能用；签名不对拿不到文件', async () => {
    expect((await dev.post(`/api/tools/versions/${pendingId}/preview`, { circleId: 'nuaa' })).status).toBe(403)
    expect((await admin.post(`/api/tools/versions/${pendingId}/preview`, { circleId: circleA })).status).toBe(403)

    await admin.post('/api/circles/nuaa/join')
    const grant = await admin.post<{ token: string; context: { entryUrl: string; scopes: string[] } }>(
      `/api/tools/versions/${pendingId}/preview`,
      { circleId: 'nuaa' },
    )
    expect(grant.status).toBe(200)
    expect(grant.body.context.scopes).toEqual(manifest.permissions)
    const entryPath = new URL(grant.body.context.entryUrl).pathname
    expect(entryPath).toMatch(new RegExp(`^/review/${pendingId}/\\d+\\.[0-9a-f]{32}/$`))
    const page = await app.request(entryPath)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain('frame-ancestors')
    expect(await page.text()).toContain('点名 v2')
    expect((await app.request(entryPath.replace(/[0-9a-f]{32}\/$/, `${'0'.repeat(32)}/`))).status).toBe(404)

    const saved = await toolApi(grant.body.token, '/storage/preview', { method: 'PUT', body: JSON.stringify({ value: 1 }) })
    expect(saved.status).toBe(200)
    expect((await toolApi(grant.body.token, '/members')).status).toBe(200)
  })

  it('驳回要写原因，开发者能看到', async () => {
    expect((await admin.post(`/api/tools/versions/${pendingId}/review`, { decision: 'reject' })).status).toBe(400)
    const { status, body } = await admin.post<{ version: { status: string } }>(
      `/api/tools/versions/${pendingId}/review`,
      { decision: 'reject', note: '先把说明写清楚' },
    )
    expect(status).toBe(200)
    expect(body.version.status).toBe('rejected')

    const mine = await dev.json<{ tools: { slug: string; versions: { version: string; review: { admin?: { note?: string } } }[] }[] }>('/api/tools/mine')
    const version = mine.body.tools.find((t) => t.slug === 'roll-call')?.versions.find((v) => v.version === '1.0.2')
    expect(version?.review.admin?.note).toBe('先把说明写清楚')

    const queue = await admin.json<{ pending: ReviewItem[]; recent: ReviewItem[] }>('/api/tools/review')
    expect(ofRollCall(queue.body.pending)).toEqual([])
    expect(ofRollCall(queue.body.recent)[0]?.version).toBe('1.0.2')
  })

  it('下架当前上架版本后退回更早的已通过版本，都没有就从市场消失；驳回的可以改判通过', async () => {
    const published = await publish(dev, pack({
      'harth.json': JSON.stringify({ ...manifest, version: '1.0.3' }),
      'index.html': '<!doctype html><script src="/_harth/sdk.js"></script><p>点名 v3</p>',
    }))
    const v3 = published.body.version.id
    await admin.post(`/api/tools/versions/${v3}/review`, { decision: 'approve' })
    expect(await marketVersion()).toBe('1.0.3')

    await admin.post(`/api/tools/versions/${v3}/review`, { decision: 'reject', note: '有问题，先下架' })
    expect(await marketVersion()).toBe('1.0.1')

    await admin.post(`/api/tools/versions/${versionId}/review`, { decision: 'reject', note: '一起下架' })
    expect(await marketVersion()).toBeUndefined()
    expect((await owner.post(`/api/circles/${circleB}/tools/roll-call`)).status).toBe(404)
    expect((await app.request('/t/roll-call/')).status).toBe(404)

    await admin.post(`/api/tools/versions/${v3}/review`, { decision: 'approve' })
    expect(await marketVersion()).toBe('1.0.3')
  })
})
