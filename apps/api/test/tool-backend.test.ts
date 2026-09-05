import { describeCron } from '@harth/shared'
import { strToU8, zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { seed } from '../src/db/seed'
import { TestUser } from './helpers'

const admin = new TestUser('管理员')
const dev = new TestUser('开发者')
const owner = new TestUser('圈主')
const member = new TestUser('成员')
let circleId = ''
let memberToken = ''

const SLUG = 'roll-call-be'

const SERVER_JS = `
export default {
  async tally(harth, input) {
    const item = await harth.storage.get('count')
    const next = (item ? item.value : 0) + ((input && input.by) || 1)
    await harth.storage.set('count', next)
    console.log('tally', next)
    return { count: next, who: harth.user ? harth.user.name : null, trigger: harth.trigger }
  },
  async remind(harth) {
    const members = await harth.members()
    await harth.posts.create({ title: '提醒：今天记得点名', body: '一共 ' + members.length + ' 人' })
    return { members: members.length }
  },
  loop() { let i = 0; while (true) { i++ } },
  hog() { const a = []; while (true) { a.push(new Array(100000).fill(1)) } },
  never() { return new Promise(() => {}) },
  flood(harth) { const ps = []; for (let i = 0; i < 150; i++) ps.push(harth.storage.get('k' + i)); return Promise.all(ps) },
  leak() { const e = new Error('secret-in-error'); e.name = 'SecretName'; throw e },
  spam(harth) { return Promise.all([1, 2, 3, 4].map((i) => harth.posts.create({ title: 'spam ' + i }))) },
}
`

const ACTIONS = [
  { name: 'tally', description: '计数' },
  { name: 'remind', description: '提醒', triggers: ['schedule'] },
  { name: 'loop', description: '死循环' },
  { name: 'hog', description: '吃内存' },
  { name: 'never', description: '永不返回' },
  { name: 'flood', description: '狂调接口' },
  { name: 'leak', description: '抛异常' },
  { name: 'spam', description: '刷帖' },
]

const manifest = {
  slug: SLUG,
  name: '点名后端',
  version: '1.0.0',
  description: '带后端的测试工具',
  backend: 'server.js',
  permissions: ['user.profile', 'storage', 'members.read', 'posts.write', 'schedule'],
  actions: ACTIONS,
  schedules: [{ name: 'morning', cron: '0 8 * * 1-5', action: 'remind' }],
}

function pack(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
}

function bundle(overrides: Record<string, unknown> = {}, files: Record<string, string> = {}): Uint8Array {
  return pack({
    'harth.json': JSON.stringify({ ...manifest, ...overrides }),
    'index.html': '<!doctype html><script src="/_harth/sdk.js"></script><p>点名</p>',
    'server.js': SERVER_JS,
    ...files,
  })
}

interface Check {
  name: string
  ok: boolean
  detail?: string
}

async function publish(user: TestUser, zip: Uint8Array) {
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
  return user.json<{ version: { id: string; status: string; review: { checks: Check[] } }; error?: string }>(
    '/api/tools/publish',
    { method: 'POST', body, headers: { 'content-type': 'application/zip' } },
  )
}

async function toolApi(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init.body) headers.set('content-type', 'application/json')
  const res = await app.request(`/api/tool${path}`, { ...init, headers })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

function call(token: string, action: string, input?: unknown) {
  return toolApi(token, `/actions/${action}`, { method: 'POST', body: JSON.stringify({ input }) })
}

interface RunView {
  id: string
  trigger: string
  action: string
  status: string
  errorCode: string | null
  error: string | null
  logs: string | null
  result?: unknown
}

async function ownerRuns(): Promise<RunView[]> {
  const res = await owner.json<{ runs: RunView[] }>(`/api/circles/${circleId}/tools/${SLUG}/runs`)
  return res.body.runs
}

async function waitRuns(predicate: (runs: RunView[]) => boolean, timeoutMs = 10_000): Promise<RunView[]> {
  const deadline = Date.now() + timeoutMs
  let runs = await ownerRuns()
  while (!predicate(runs) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
    runs = await ownerRuns()
  }
  return runs
}

async function due() {
  await admin.post('/api/test/tool-schedules-due', { circleId, slug: SLUG })
  return admin.post<{ created: number; skipped: number }>('/api/test/tool-tick', {})
}

async function lastActivity(): Promise<string> {
  const mine = await owner.json<{ circles: { id: string; lastActivityAt: string }[] }>('/api/circles/mine')
  return mine.body.circles.find((c) => c.id === circleId)!.lastActivityAt
}

beforeAll(async () => {
  await seed()
  await admin.signUp('admin2@test.dev')
  await dev.signUp('dev-be@test.dev')
  await owner.signUp('owner-be@test.dev')
  await member.signUp('member-be@test.dev')
  for (const u of [owner, member, dev]) await u.post('/api/circles/nuaa/join')
  const created = await owner.post('/api/circles', { name: '后端圈', visibility: 'public', parentIds: ['nuaa'] })
  circleId = (created.body as { circle: { id: string } }).circle.id
  await member.post(`/api/circles/${circleId}/join`)
  await dev.post(`/api/circles/${circleId}/join`)
}, 120_000)

describe('清单与自动检查', () => {
  it('cron 只认五段数字形态，人话翻译覆盖常见形态', () => {
    expect(describeCron('0 8 * * 1-5')).toBe('每个工作日 08:00')
    expect(describeCron('30 21 * * *')).toBe('每天 21:30')
    expect(describeCron('0 9 * * 1,3')).toBe('每周一、三 09:00')
    expect(describeCron('0 10 1 * *')).toBe('每月 1 日 10:00')
    expect(describeCron('*/15 * * * *')).toBe('每 15 分钟')
    expect(describeCron('0 */6 * * *')).toBe('每 6 小时（第 0 分）')
    expect(describeCron('0,10,11 * * * *')).toBeNull()
  })

  it('声明了 schedules 但没申请 schedule 权限、或引用未声明的动作，清单直接不合法', async () => {
    const noScope = await publish(dev, bundle({ permissions: ['storage'] }))
    expect(noScope.status).toBe(400)
    expect(noScope.body.error).toContain('schedule')
    const badAction = await publish(dev, bundle({ schedules: [{ name: 'x', cron: '0 8 * * *', action: 'nope' }] }))
    expect(badAction.status).toBe(400)
    const sixFields = await publish(dev, bundle({ schedules: [{ name: 'x', cron: '0 0 8 * * *', action: 'remind' }] }))
    expect(sixFields.status).toBe(400)
  })

  it('后端文件缺失、时间表过密、藏了密钥、动作没实现，都过不了自动检查', async () => {
    const failed = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => c.name)
    const missing = await publish(dev, bundle({ version: '0.0.1', backend: 'missing.js' }))
    expect(missing.body.version.status).toBe('rejected')
    expect(failed(missing.body.version.review.checks)).toContain('后端文件')

    const dense = await publish(dev, bundle({ version: '0.0.2', schedules: [{ name: 'x', cron: '0,10,11 * * * *', action: 'remind' }] }))
    expect(failed(dense.body.version.review.checks)).toContain('时间表')

    const secret = await publish(dev, bundle({ version: '0.0.3' }, { 'config.js': 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456"' }))
    expect(failed(secret.body.version.review.checks)).toContain('凭据')

    const broken = await publish(dev, bundle({ version: '0.0.4' }, { 'server.js': 'export default { other() {} }' }))
    expect(failed(broken.body.version.review.checks)).toContain('后端代码')
    expect(broken.body.version.review.checks.find((c) => c.name === '后端代码')?.detail).toContain('tally')

    const syntax = await publish(dev, bundle({ version: '0.0.5' }, { 'server.js': 'export default {' }))
    expect(failed(syntax.body.version.review.checks)).toContain('后端代码')
  })

  it('合规的包进入待审，管理员不能通过检查失败的版本', async () => {
    const ok = await publish(dev, bundle())
    expect(ok.status).toBe(201)
    expect(ok.body.version.status).toBe('pending')
    expect(ok.body.version.review.checks.every((c) => c.ok)).toBe(true)

    const rejected = await publish(dev, bundle({ version: '0.0.6', backend: 'missing.js' }))
    const blocked = await admin.post(`/api/tools/versions/${rejected.body.version.id}/review`, { decision: 'approve' })
    expect(blocked.status).toBe(409)

    const approved = await admin.post(`/api/tools/versions/${ok.body.version.id}/review`, { decision: 'approve' })
    expect(approved.status).toBe(200)
    const market = await owner.json<{ tools: { slug: string; name: string }[] }>('/api/tools')
    expect(market.body.tools.find((t) => t.slug === SLUG)?.name).toBe('点名后端')
  })
})

describe('安装、调用与限额', () => {
  it('安装时记下时间表快照，市场页能看到时间表', async () => {
    const detail = await owner.json<{ tool: { hasBackend: boolean; schedules: { cron: string }[] } }>(`/api/tools/${SLUG}`)
    expect(detail.body.tool.hasBackend).toBe(true)
    expect(detail.body.tool.schedules[0]?.cron).toBe('0 8 * * 1-5')
    expect((await owner.post(`/api/circles/${circleId}/tools/${SLUG}`)).status).toBe(201)
    const list = await owner.json<{ tools: { slug: string; hasBackend: boolean; needsConfirm: boolean; schedules: { name: string }[] }[] }>(
      `/api/circles/${circleId}/tools`,
    )
    const installed = list.body.tools.find((t) => t.slug === SLUG)!
    expect(installed.hasBackend).toBe(true)
    expect(installed.needsConfirm).toBe(false)
    expect(installed.schedules.map((s) => s.name)).toEqual(['morning'])
    const token = await member.post<{ token: string }>(`/api/circles/${circleId}/tools/${SLUG}/token`)
    memberToken = token.body.token
  })

  it('前端调用后端动作，后端和前端读写同一份存储', async () => {
    const first = await call(memberToken, 'tally', { by: 2 })
    expect(first.status).toBe(200)
    expect(first.body.result).toEqual({ count: 2, who: '成员', trigger: 'call' })
    const second = await call(memberToken, 'tally')
    expect((second.body.result as { count: number }).count).toBe(3)
    const stored = await toolApi(memberToken, '/storage/count')
    expect((stored.body.item as { value: number }).value).toBe(3)
  })

  it('没声明的动作和只允许定时的动作，前端都调不了', async () => {
    expect((await call(memberToken, 'nope')).status).toBe(404)
    expect((await call(memberToken, 'remind')).status).toBe(404)
  })

  it('死循环按脚本执行时间终止，期间平台照常响应', async () => {
    const started = Date.now()
    const health = app.request('/health')
    const res = await call(memberToken, 'loop')
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('SCRIPT_TIME')
    expect(Date.now() - started).toBeLessThan(8_000)
    expect((await health).status).toBe(200)
  })

  it('内存炸弹被终止', async () => {
    const res = await call(memberToken, 'hog')
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('MEMORY')
  })

  it('永不完成的 Promise 按总时长超时，执行器换新的继续服务', async () => {
    const res = await call(memberToken, 'never')
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('TIMEOUT')
    const again = await call(memberToken, 'tally')
    expect(again.status).toBe(200)
  }, 30_000)

  it('宿主调用次数与发帖数超预算即失败', async () => {
    const flood = await call(memberToken, 'flood')
    expect(flood.body.code).toBe('BUDGET')
    const spam = await call(memberToken, 'spam')
    expect(spam.body.code).toBe('BUDGET')
  })

  it('异常里的内容只有圈主看得到，开发者只看到错误码统计', async () => {
    const res = await call(memberToken, 'leak')
    expect(res.body.code).toBe('GUEST_ERROR')
    const runs = await ownerRuns()
    const leak = runs.find((r) => r.action === 'leak')!
    expect(leak.error).toContain('secret-in-error')
    const tally = runs.find((r) => r.action === 'tally')!
    expect(tally.logs).toContain('tally')
    expect((await dev.json(`/api/circles/${circleId}/tools/${SLUG}/runs`)).status).toBe(403)
    const mine = await dev.json<{ tools: { slug: string; runs: { total: number; ok: number; failed: Record<string, number> } }[] }>('/api/tools/mine')
    const stats = mine.body.tools.find((t) => t.slug === SLUG)!.runs
    expect(stats.total).toBeGreaterThanOrEqual(7)
    expect(stats.failed.GUEST_ERROR).toBe(1)
    expect(JSON.stringify(mine.body)).not.toContain('secret')
  })
})

describe('定时运行', () => {
  it('到点后以工具身份发帖，不刷新圈子活跃，处理过的时间表不会重复投递', async () => {
    const before = await lastActivity()
    const tick = await due()
    expect(tick.status).toBe(200)
    expect(tick.body.created).toBe(1)
    const runs = await waitRuns((list) => list.some((r) => r.trigger === 'schedule' && r.status !== 'queued' && r.status !== 'running'))
    const scheduled = runs.find((r) => r.trigger === 'schedule')!
    expect(scheduled.status).toBe('ok')
    expect(scheduled.action).toBe('remind')

    const posts = await member.json<{ posts: { title: string; authorId: string | null; authorName: string | null; toolName: string | null }[] }>(
      `/api/posts/circles/${circleId}`,
    )
    const reminder = posts.body.posts.find((p) => p.title === '提醒：今天记得点名')!
    expect(reminder.authorId).toBeNull()
    expect(reminder.toolName).toBe('点名后端')
    expect(await lastActivity()).toBe(before)

    const again = await admin.post<{ created: number }>('/api/test/tool-tick', {})
    expect(again.body.created).toBe(0)
  })

  it('每小时定时运行有上限，超出记 BUDGET', async () => {
    for (let i = 0; i < 12; i++) await due()
    const runs = await waitRuns((list) => list.filter((r) => r.trigger === 'schedule' && r.status === 'skipped').length >= 1, 20_000)
    expect(runs.some((r) => r.status === 'skipped' && r.errorCode === 'BUDGET')).toBe(true)
  }, 40_000)
})

describe('授权变化', () => {
  it('新版本改了时间表要圈主确认，确认前按旧快照', async () => {
    const next = await publish(dev, bundle({ version: '1.1.0', schedules: [{ name: 'morning', cron: '0 9 * * *', action: 'remind' }] }))
    expect(next.body.version.status).toBe('pending')
    await admin.post(`/api/tools/versions/${next.body.version.id}/review`, { decision: 'approve' })
    let list = await owner.json<{ tools: { slug: string; needsConfirm: boolean; schedules: { cron: string }[]; pending: { schedules: { cron: string }[] } }[] }>(
      `/api/circles/${circleId}/tools`,
    )
    let installed = list.body.tools.find((t) => t.slug === SLUG)!
    expect(installed.needsConfirm).toBe(true)
    expect(installed.schedules[0]?.cron).toBe('0 8 * * 1-5')
    expect(installed.pending.schedules[0]?.cron).toBe('0 9 * * *')

    expect((await member.post(`/api/circles/${circleId}/tools/${SLUG}/confirm`)).status).toBe(403)
    expect((await owner.post(`/api/circles/${circleId}/tools/${SLUG}/confirm`)).status).toBe(200)
    list = await owner.json(`/api/circles/${circleId}/tools`)
    installed = list.body.tools.find((t) => t.slug === SLUG)!
    expect(installed.needsConfirm).toBe(false)
    expect(installed.schedules[0]?.cron).toBe('0 9 * * *')
  })

  it('退圈后旧令牌调不了动作；重装后旧令牌失效；归档圈只读', async () => {
    await member.post(`/api/circles/${circleId}/leave`)
    expect((await call(memberToken, 'tally')).status).toBe(403)
    await member.post(`/api/circles/${circleId}/join`)
    expect((await call(memberToken, 'tally')).status).toBe(200)

    expect((await owner.post(`/api/circles/${circleId}/tools/${SLUG}`)).status).toBe(201)
    expect((await call(memberToken, 'tally')).status).toBe(403)
    const fresh = (await member.post<{ token: string }>(`/api/circles/${circleId}/tools/${SLUG}/token`)).body.token
    memberToken = fresh
    expect((await call(memberToken, 'tally')).status).toBe(200)
  })

  it('卸载后时间表与运行记录清空', async () => {
    expect((await owner.delete(`/api/circles/${circleId}/tools/${SLUG}`)).status).toBe(200)
    expect((await ownerRuns()).length).toBe(0)
    const tick = await admin.post<{ created: number }>('/api/test/tool-tick', {})
    expect(tick.body.created).toBe(0)
  })
})

describe('开发会话', () => {
  it('后端代码随会话上传，harth run 在自己的命名空间里跑，日志只有开发者看得到', async () => {
    const put = await dev.put<{ session: { backendHash: string | null } }>('/api/tools/dev-session', {
      circleId,
      url: 'http://localhost:3102',
      manifest: { ...manifest, version: '9.9.9' },
      backend: SERVER_JS,
    })
    expect(put.status).toBe(200)
    expect(put.body.session.backendHash).toHaveLength(64)

    const run = await dev.post<{ run: RunView }>('/api/tools/dev-session/run', { action: 'tally', input: { by: 5 } })
    expect(run.status).toBe(200)
    expect(run.body.run.status).toBe('ok')
    expect(run.body.run.result).toEqual({ count: 5, who: '开发者', trigger: 'manual' })
    expect(run.body.run.logs).toContain('tally 5')

    const devToken = (await dev.post<{ token: string }>(`/api/circles/${circleId}/tools/_dev/token`)).body.token
    const viaFrontend = await call(devToken, 'tally')
    expect((viaFrontend.body.result as { count: number }).count).toBe(6)

    const list = await dev.json<{ runs: RunView[] }>('/api/tools/dev-session/runs')
    expect(list.body.runs.map((r) => r.trigger)).toEqual(['call', 'manual'])

    const withoutBackend = await dev.put('/api/tools/dev-session', { circleId, url: 'http://localhost:3102', manifest: { ...manifest, version: '9.9.9' } })
    expect(withoutBackend.status).toBe(200)
    const noCode = await dev.post<{ run: RunView }>('/api/tools/dev-session/run', { action: 'tally' })
    expect(noCode.body.run.errorCode).toBe('ACTION_MISSING')
    await dev.delete('/api/tools/dev-session')
  })
})
