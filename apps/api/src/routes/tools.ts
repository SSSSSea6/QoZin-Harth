import { toolManifestSchema, toolSlugSchema, type ToolManifest } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { circles, circleTools, memberships, toolDevSessions, tools, toolVersions } from '../db/schema'
import { getMembership } from '../domain/circles'
import { env } from '../env'
import { requireAuth } from '../middleware/session'
import { DEV_TOOL_SLUG } from './circle-tools'
import {
  adminDecide,
  currentVersion,
  ensureTool,
  getTool,
  getVersion,
  isAdmin,
  publish,
  rereview,
  type ToolVersionRow,
} from '../tools/service'
import type { AppEnv } from '../types'

const DEV_SESSION_HOURS = 12

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

  .post('/publish', async (c) => {
    const zip = new Uint8Array(await c.req.arrayBuffer())
    if (zip.byteLength === 0) throw new HTTPException(400, { message: '请求体为空' })
    const { tool, version } = await publish(c.get('user')!.id, zip)
    return c.json({ tool: { slug: tool.slug, name: tool.name }, version: versionView(version) }, 201)
  })

  .get('/versions/:id', async (c) => {
    const user = c.get('user')!
    const version = await getVersion(c.req.param('id'))
    if (!version) throw new HTTPException(404, { message: '版本不存在' })
    const [tool] = await db.select().from(tools).where(eq(tools.id, version.toolId)).limit(1)
    if (!tool || (tool.ownerId !== user.id && !isAdmin(user))) {
      throw new HTTPException(404, { message: '版本不存在' })
    }
    return c.json({ tool: { slug: tool.slug, name: tool.name }, version: versionView(version) })
  })

  .post(
    '/versions/:id/review',
    zValidator(
      'json',
      z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() }),
    ),
    async (c) => {
      const user = c.get('user')!
      if (!isAdmin(user)) throw new HTTPException(403, { message: '只有管理员能审核' })
      const { decision, note } = c.req.valid('json')
      const version = await adminDecide(user.id, c.req.param('id'), decision, note)
      return c.json({ version: versionView(version) })
    },
  )

  .post('/versions/:id/rereview', async (c) => {
    const user = c.get('user')!
    const version = await getVersion(c.req.param('id'))
    if (!version) throw new HTTPException(404, { message: '版本不存在' })
    const [tool] = await db.select().from(tools).where(eq(tools.id, version.toolId)).limit(1)
    if (!tool || (tool.ownerId !== user.id && !isAdmin(user))) {
      throw new HTTPException(404, { message: '版本不存在' })
    }
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
