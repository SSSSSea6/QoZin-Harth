import {
  TOOL_BACKEND_MAX_BYTES,
  TOOL_PACKAGE_MAX_BYTES,
  TOOL_RUN_LIMITS,
  toolActionNameSchema,
  toolManifestSchema,
  toolSlugSchema,
  type ToolManifest,
} from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { circles, circleTools, memberships, toolDevSessions, toolRuns, tools, toolVersions } from '../db/schema'
import { assertNotArchived, getMembership, mustGetCircle, mustGetMembership } from '../domain/circles'
import { developerOf, requireDeveloper, statusOf } from '../domain/developers'
import { env, isAdmin } from '../env'
import { requireAuth } from '../middleware/session'
import { DEV_TOOL_SLUG } from './circle-tools'
import { usageSummary } from '../tools/fuel'
import { backendHash, createRun, manifestOf, waitForRun, type ToolRunRow } from '../tools/runs'
import {
  adminDecide,
  currentVersion,
  ensureTool,
  getTool,
  getVersion,
  listFiles,
  publish,
  rereview,
  type ToolRow,
  type ToolVersionRow,
} from '../tools/service'
import { issueToolToken, signPreviewPath } from '../tools/token'
import type { AppEnv } from '../types'

const DEV_SESSION_HOURS = 12
const REVIEW_FILES_MAX_BYTES = 300 * 1024
const RECENT_REVIEWS = 20
const DEV_RUNS = 20

type SessionUser = NonNullable<AppEnv['Variables']['user']>

// 先看声明的长度，再边读边数，超过上限就停下
async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  const tooBig = () => new HTTPException(413, { message: `包超过 ${max / 1024 / 1024} MB` })
  if (Number(req.headers.get('content-length') ?? 0) > max) throw tooBig()
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function versionView(v: ToolVersionRow) {
  return {
    id: v.id,
    version: v.version,
    status: v.status,
    review: v.review,
    createdAt: v.createdAt,
    reviewedAt: v.reviewedAt,
  }
}

function runView(run: ToolRunRow) {
  return {
    id: run.id,
    trigger: run.trigger,
    action: run.action,
    status: run.status,
    errorCode: run.errorCode,
    error: run.error,
    logs: run.logs,
    result: run.result,
    durationMs: run.durationMs,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  }
}

function requireAdmin(me: SessionUser): void {
  if (!isAdmin(me)) throw new HTTPException(403, { message: '只有管理员能审核' })
}

// 开发者看自己的，管理员看所有的，其他人当不存在
async function accessibleVersion(
  me: SessionUser,
  id: string,
): Promise<{ version: ToolVersionRow; tool: ToolRow }> {
  const version = await getVersion(id)
  const [tool] = version ? await db.select().from(tools).where(eq(tools.id, version.toolId)).limit(1) : []
  if (!version || !tool || (tool.ownerId !== me.id && !isAdmin(me))) {
    throw new HTTPException(404, { message: '版本不存在' })
  }
  return { version, tool }
}

async function devSessionOf(userId: string) {
  const rows = await db
    .select({ session: toolDevSessions, tool: tools })
    .from(toolDevSessions)
    .innerJoin(tools, eq(toolDevSessions.toolId, tools.id))
    .where(eq(toolDevSessions.userId, userId))
    .limit(1)
  const row = rows[0]
  if (!row || row.session.expiresAt < new Date()) return null
  return row
}

function reviewItem({
  version,
  tool,
  developer,
}: {
  version: ToolVersionRow
  tool: ToolRow
  developer: { id: string; name: string }
}) {
  const manifest = version.manifest as ToolManifest
  return {
    ...versionView(version),
    tool: { slug: tool.slug, name: tool.name },
    developer,
    description: manifest.description,
    permissions: manifest.permissions,
  }
}

export const toolsApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/', async (c) => {
    const rows = await db
      .select({ tool: tools, version: toolVersions })
      .from(tools)
      .innerJoin(toolVersions, eq(tools.currentVersionId, toolVersions.id))
      .where(isNotNull(tools.currentVersionId))
      .orderBy(desc(toolVersions.reviewedAt))
    return c.json({
      tools: rows.map(({ tool, version }) => {
        const manifest = version.manifest as ToolManifest
        return {
          slug: tool.slug,
          name: tool.name,
          description: manifest.description,
          permissions: manifest.permissions,
          version: version.version,
          updatedAt: version.reviewedAt,
        }
      }),
    })
  })

  // 开发者看自己的工具：版本、装在几个圈、近 7 天运行次数、本月燃料；真实圈的内容一律不给
  .get('/mine', async (c) => {
    const me = c.get('user')!
    const mine = await db
      .select()
      .from(tools)
      .where(eq(tools.ownerId, me.id))
      .orderBy(desc(tools.createdAt))
    const [usage, developer] = await Promise.all([usageSummary(me.id), developerOf(db, me.id)])
    const installs = new Map<string, number>()
    if (mine.length > 0) {
      const rows = await db
        .select({ toolId: circleTools.toolId, value: sql<number>`count(*)`.mapWith(Number) })
        .from(circleTools)
        .where(inArray(circleTools.toolId, mine.map((tool) => tool.id)))
        .groupBy(circleTools.toolId)
      for (const row of rows) installs.set(row.toolId, row.value)
    }
    const result = []
    for (const tool of mine) {
      const versions = await db
        .select()
        .from(toolVersions)
        .where(eq(toolVersions.toolId, tool.id))
        .orderBy(desc(toolVersions.createdAt))
      const stats = usage.tools.get(tool.id)
      result.push({
        slug: tool.slug,
        name: tool.name,
        currentVersionId: tool.currentVersionId,
        versions: versions.map(versionView),
        installs: installs.get(tool.id) ?? 0,
        week: {
          runs: stats?.week.runs ?? 0,
          ok: stats?.week.ok ?? 0,
          failed: stats?.week.failed ?? 0,
          skipped: stats?.week.skipped ?? 0,
        },
        monthUnits: stats?.month.units ?? 0,
      })
    }
    return c.json({
      tools: result,
      developer: statusOf(developer),
      usage: {
        month: usage.month,
        used: usage.used,
        reserved: usage.reserved,
        allowance: usage.allowance,
        storageBytes: usage.storageBytes,
      },
    })
  })

  .get('/review', async (c) => {
    requireAdmin(c.get('user')!)
    const query = () =>
      db
        .select({ version: toolVersions, tool: tools, developer: { id: user.id, name: user.name } })
        .from(toolVersions)
        .innerJoin(tools, eq(toolVersions.toolId, tools.id))
        .innerJoin(user, eq(tools.ownerId, user.id))
    const pending = await query()
      .where(eq(toolVersions.status, 'pending'))
      .orderBy(asc(toolVersions.createdAt))
    const recent = await query()
      .where(ne(toolVersions.status, 'pending'))
      .orderBy(desc(toolVersions.reviewedAt))
      .limit(RECENT_REVIEWS)
    return c.json({ pending: pending.map(reviewItem), recent: recent.map(reviewItem) })
  })

  // 资格门禁在读包之前，没资格的连解压都不做
  .post('/publish', async (c) => {
    const me = c.get('user')!
    await requireDeveloper(me.id)
    const zip = await readCapped(c.req.raw, TOOL_PACKAGE_MAX_BYTES)
    if (zip.byteLength === 0) throw new HTTPException(400, { message: '请求体为空' })
    const { tool, version } = await publish(me.id, zip)
    return c.json({ tool: { slug: tool.slug, name: tool.name }, version: versionView(version) }, 201)
  })

  .get('/versions/:id', async (c) => {
    const { version, tool } = await accessibleVersion(c.get('user')!, c.req.param('id'))
    const [developer] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.id, tool.ownerId))
      .limit(1)
    return c.json({
      tool: { slug: tool.slug, name: tool.name },
      version: versionView(version),
      manifest: manifestOf(version.manifest),
      developer: developer!,
      isCurrent: tool.currentVersionId === version.id,
    })
  })

  .get('/versions/:id/files', async (c) => {
    const { version } = await accessibleVersion(c.get('user')!, c.req.param('id'))
    return c.json(await listFiles(version, REVIEW_FILES_MAX_BYTES))
  })

  .post('/versions/:id/preview', zValidator('json', z.object({ circleId: z.string() })), async (c) => {
    const me = c.get('user')!
    requireAdmin(me)
    const { version, tool } = await accessibleVersion(me, c.req.param('id'))
    const circle = await mustGetCircle(c.req.valid('json').circleId)
    assertNotArchived(circle)
    if (circle.isDm) throw new HTTPException(400, { message: '双人圈不能试运行工具' })
    await mustGetMembership(circle.id, me.id)
    const manifest = manifestOf(version.manifest)
    const { token, expiresAt } = await issueToolToken({
      sub: me.id,
      cid: circle.id,
      tid: tool.id,
      scopes: manifest.permissions,
      review: true,
      vid: version.id,
    })
    const entryUrl = `${env.TOOL_ORIGIN}/review/${version.id}/${signPreviewPath(version.id)}/`
    return c.json({
      token,
      expiresAt,
      context: {
        user: { id: me.id, name: me.name },
        circle: { id: circle.id, name: circle.name },
        tool: { slug: tool.slug, name: manifest.name, version: version.version },
        scopes: manifest.permissions,
        apiUrl: env.BETTER_AUTH_URL,
        entryUrl,
        origin: new URL(entryUrl).origin,
      },
    })
  })

  .post(
    '/versions/:id/review',
    zValidator(
      'json',
      z.object({
        decision: z.enum(['approve', 'reject']),
        note: z.string().trim().max(500).optional(),
      }),
    ),
    async (c) => {
      const me = c.get('user')!
      requireAdmin(me)
      const { decision, note } = c.req.valid('json')
      if (decision === 'reject' && !note) throw new HTTPException(400, { message: '驳回要写明原因' })
      const version = await adminDecide(me.id, c.req.param('id'), decision, note || undefined)
      return c.json({ version: versionView(version) })
    },
  )

  .post('/versions/:id/rereview', async (c) => {
    const { version } = await accessibleVersion(c.get('user')!, c.req.param('id'))
    await rereview(version)
    return c.json({ version: versionView((await getVersion(version.id))!) })
  })

  .get('/dev-session', async (c) => {
    const row = await devSessionOf(c.get('user')!.id)
    if (!row) return c.json({ session: null })
    return c.json({
      session: {
        circleId: row.session.circleId,
        url: row.session.url,
        slug: row.tool.slug,
        backendHash: row.session.backendHash,
        expiresAt: row.session.expiresAt,
      },
    })
  })

  // 开发会话随手带上后端代码，改一次传一次；定时任务在开发会话里不自动跑
  .put(
    '/dev-session',
    zValidator(
      'json',
      z.object({
        circleId: z.string(),
        url: z.url(),
        manifest: toolManifestSchema,
        backend: z.string().max(TOOL_BACKEND_MAX_BYTES, `后端代码不能超过 ${TOOL_BACKEND_MAX_BYTES / 1024} KB`).optional(),
      }),
    ),
    async (c) => {
      const me = c.get('user')!
      const { circleId, url, manifest, backend } = c.req.valid('json')
      if (!(await getMembership(circleId, me.id))) {
        throw new HTTPException(403, { message: '你不在这个圈子里' })
      }
      const tool = await ensureTool(me.id, manifest.slug, manifest.name)
      const expiresAt = new Date(Date.now() + DEV_SESSION_HOURS * 60 * 60 * 1000)
      const hash = backend ? backendHash(backend) : null
      await db
        .insert(toolDevSessions)
        .values({ userId: me.id, circleId, toolId: tool.id, url, manifest, backend: backend ?? null, backendHash: hash, expiresAt })
        .onConflictDoUpdate({
          target: toolDevSessions.userId,
          set: { circleId, toolId: tool.id, url, manifest, backend: backend ?? null, backendHash: hash, expiresAt },
        })
      return c.json({
        session: { circleId, url, slug: tool.slug, backendHash: hash, expiresAt },
        openUrl: `${env.WEB_URL}/c/${circleId}/t/${DEV_TOOL_SLUG}`,
      })
    },
  )

  .delete('/dev-session', async (c) => {
    await db.delete(toolDevSessions).where(eq(toolDevSessions.userId, c.get('user')!.id))
    return c.json({ ok: true })
  })

  // harth run：在开发会话的圈里跑一次动作，等结果
  .post(
    '/dev-session/run',
    zValidator('json', z.object({ action: toolActionNameSchema, input: z.unknown().optional() })),
    async (c) => {
      const me = c.get('user')!
      const row = await devSessionOf(me.id)
      if (!row) throw new HTTPException(404, { message: '没有进行中的本地开发会话，先运行 harth dev' })
      const { action, input } = c.req.valid('json')
      const run = await createRun({
        toolId: row.tool.id,
        circleId: row.session.circleId,
        versionId: null,
        environment: 'dev',
        trigger: 'manual',
        action,
        input: input ?? null,
        userId: me.id,
      })
      return c.json({ run: runView(await waitForRun(run.id, TOOL_RUN_LIMITS.totalMs + 5_000)) })
    },
  )

  .get('/dev-session/runs', async (c) => {
    const me = c.get('user')!
    const row = await devSessionOf(me.id)
    if (!row) throw new HTTPException(404, { message: '没有进行中的本地开发会话' })
    const rows = await db
      .select()
      .from(toolRuns)
      .where(
        and(
          eq(toolRuns.toolId, row.tool.id),
          eq(toolRuns.circleId, row.session.circleId),
          eq(toolRuns.environment, 'dev'),
          eq(toolRuns.userId, me.id),
        ),
      )
      .orderBy(desc(toolRuns.createdAt))
      .limit(DEV_RUNS)
    return c.json({ runs: rows.map(runView) })
  })

  .get('/:slug', zValidator('param', z.object({ slug: toolSlugSchema })), async (c) => {
    const me = c.get('user')!
    const tool = await getTool(c.req.valid('param').slug)
    const version = tool ? await currentVersion(tool) : null
    if (!tool || !version) throw new HTTPException(404, { message: '工具不存在或还没上架' })
    const manifest = manifestOf(version.manifest)

    const owned = await db
      .select({ id: circles.id, name: circles.name })
      .from(memberships)
      .innerJoin(circles, eq(memberships.circleId, circles.id))
      .where(
        and(
          eq(memberships.userId, me.id),
          eq(memberships.role, 'owner'),
          eq(circles.isDm, false),
          isNull(circles.archivedAt),
        ),
      )
    const installed = await db
      .select({ circleId: circleTools.circleId })
      .from(circleTools)
      .where(eq(circleTools.toolId, tool.id))
    const installedIn = new Set(installed.map((r) => r.circleId))

    return c.json({
      tool: {
        slug: tool.slug,
        name: tool.name,
        description: manifest.description,
        permissions: manifest.permissions,
        actions: manifest.actions,
        schedules: manifest.schedules,
        hasBackend: Boolean(manifest.backend),
        version: version.version,
        updatedAt: version.reviewedAt,
        isMine: tool.ownerId === me.id,
      },
      myCircles: owned.map((circle) => ({ ...circle, installed: installedIn.has(circle.id) })),
    })
  })
