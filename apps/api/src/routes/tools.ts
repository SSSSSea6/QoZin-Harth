import { toolManifestSchema, toolSlugSchema, type ToolManifest } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { circles, circleTools, memberships, toolDevSessions, tools, toolVersions } from '../db/schema'
import { assertNotArchived, getMembership, mustGetCircle, mustGetMembership } from '../domain/circles'
import { env, isAdmin } from '../env'
import { requireAuth } from '../middleware/session'
import { DEV_TOOL_SLUG } from './circle-tools'
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

type SessionUser = NonNullable<AppEnv['Variables']['user']>

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

function manifestOf(v: ToolVersionRow | null): ToolManifest | null {
  return (v?.manifest as ToolManifest | undefined) ?? null
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

  .get('/mine', async (c) => {
    const userId = c.get('user')!.id
    const mine = await db
      .select()
      .from(tools)
      .where(eq(tools.ownerId, userId))
      .orderBy(desc(tools.createdAt))
    const result = []
    for (const tool of mine) {
      const versions = await db
        .select()
        .from(toolVersions)
        .where(eq(toolVersions.toolId, tool.id))
        .orderBy(desc(toolVersions.createdAt))
      result.push({
        slug: tool.slug,
        name: tool.name,
        currentVersionId: tool.currentVersionId,
        versions: versions.map(versionView),
      })
    }
    return c.json({ tools: result })
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

  .post('/publish', async (c) => {
    const zip = new Uint8Array(await c.req.arrayBuffer())
    if (zip.byteLength === 0) throw new HTTPException(400, { message: '请求体为空' })
    const { tool, version } = await publish(c.get('user')!.id, zip)
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
      manifest: version.manifest as ToolManifest,
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
    const manifest = version.manifest as ToolManifest
    const { token, expiresAt } = await issueToolToken({
      sub: me.id,
      cid: circle.id,
      tid: tool.id,
      scopes: manifest.permissions,
      review: true,
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
    const rows = await db
      .select({ session: toolDevSessions, tool: tools })
      .from(toolDevSessions)
      .innerJoin(tools, eq(toolDevSessions.toolId, tools.id))
      .where(eq(toolDevSessions.userId, c.get('user')!.id))
      .limit(1)
    const row = rows[0]
    if (!row || row.session.expiresAt < new Date()) return c.json({ session: null })
    return c.json({
      session: {
        circleId: row.session.circleId,
        url: row.session.url,
        slug: row.tool.slug,
        expiresAt: row.session.expiresAt,
      },
    })
  })

  .put(
    '/dev-session',
    zValidator(
      'json',
      z.object({ circleId: z.string(), url: z.url(), manifest: toolManifestSchema }),
    ),
    async (c) => {
      const user = c.get('user')!
      const { circleId, url, manifest } = c.req.valid('json')
      if (!(await getMembership(circleId, user.id))) {
        throw new HTTPException(403, { message: '你不在这个圈子里' })
      }
      const tool = await ensureTool(user.id, manifest.slug, manifest.name)
      const expiresAt = new Date(Date.now() + DEV_SESSION_HOURS * 60 * 60 * 1000)
      await db
        .insert(toolDevSessions)
        .values({ userId: user.id, circleId, toolId: tool.id, url, manifest, expiresAt })
        .onConflictDoUpdate({
          target: toolDevSessions.userId,
          set: { circleId, toolId: tool.id, url, manifest, expiresAt },
        })
      return c.json({
        session: { circleId, url, slug: tool.slug, expiresAt },
        openUrl: `${env.WEB_URL}/c/${circleId}/t/${DEV_TOOL_SLUG}`,
      })
    },
  )

  .delete('/dev-session', async (c) => {
    await db.delete(toolDevSessions).where(eq(toolDevSessions.userId, c.get('user')!.id))
    return c.json({ ok: true })
  })

  .get('/:slug', zValidator('param', z.object({ slug: toolSlugSchema })), async (c) => {
    const user = c.get('user')!
    const tool = await getTool(c.req.valid('param').slug)
    const version = tool ? await currentVersion(tool) : null
    if (!tool || !version) throw new HTTPException(404, { message: '工具不存在或还没上架' })
    const manifest = manifestOf(version)!

    const owned = await db
      .select({ id: circles.id, name: circles.name })
      .from(memberships)
      .innerJoin(circles, eq(memberships.circleId, circles.id))
      .where(
        and(
          eq(memberships.userId, user.id),
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
        version: version.version,
        updatedAt: version.reviewedAt,
        isMine: tool.ownerId === user.id,
      },
      myCircles: owned.map((circle) => ({ ...circle, installed: installedIn.has(circle.id) })),
    })
  })
