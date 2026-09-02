import { toolSlugSchema, type ToolManifest, type ToolScope } from '@harth/shared'
import { zValidator } from '@hono/zod-validator'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { circleTools, toolDevSessions, tools, toolStorage, toolVersions } from '../db/schema'
import { assertNotArchived, mustGetCircle, mustGetMembership, touchCircle } from '../domain/circles'
import { env } from '../env'
import { requireAuth } from '../middleware/session'
import { currentVersion, getTool } from '../tools/service'
import { issueToolToken } from '../tools/token'
import type { AppEnv } from '../types'

export const DEV_TOOL_SLUG = '_dev'

const slugParam = zValidator('param', z.object({ id: z.string(), slug: toolSlugSchema.or(z.literal(DEV_TOOL_SLUG)) }))

async function devSession(userId: string, circleId: string) {
  const rows = await db
    .select({ session: toolDevSessions, tool: tools })
    .from(toolDevSessions)
    .innerJoin(tools, eq(toolDevSessions.toolId, tools.id))
    .where(and(eq(toolDevSessions.userId, userId), eq(toolDevSessions.circleId, circleId)))
    .limit(1)
  const row = rows[0]
  if (!row || row.session.expiresAt < new Date()) return null
  return { ...row.session, manifest: row.session.manifest as ToolManifest, tool: row.tool }
}

export const circleToolsApp = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/:id/tools', async (c) => {
    const userId = c.get('user')!.id
    const circle = await mustGetCircle(c.req.param('id'))
    await mustGetMembership(circle.id, userId)
    const rows = await db
      .select({ installed: circleTools, tool: tools, version: toolVersions, installer: user.name })
      .from(circleTools)
      .innerJoin(tools, eq(circleTools.toolId, tools.id))
      .innerJoin(toolVersions, eq(tools.currentVersionId, toolVersions.id))
      .innerJoin(user, eq(circleTools.installedBy, user.id))
      .where(eq(circleTools.circleId, circle.id))
      .orderBy(circleTools.installedAt)
    const dev = await devSession(userId, circle.id)
    return c.json({
      tools: rows.map(({ installed, tool, version, installer }) => ({
        slug: tool.slug,
        name: tool.name,
        description: (version.manifest as ToolManifest).description,
        scopes: installed.scopes as ToolScope[],
        installedAt: installed.installedAt,
        installedBy: installer,
      })),
      dev: dev ? { slug: DEV_TOOL_SLUG, name: dev.manifest.name, url: dev.url } : null,
    })
  })

  .post('/:id/tools/:slug', slugParam, async (c) => {
    const userId = c.get('user')!.id
    const { id, slug } = c.req.valid('param')
    const circle = await mustGetCircle(id)
    assertNotArchived(circle)
    if (circle.isDm) throw new HTTPException(400, { message: '双人圈不能装工具' })
    const membership = await mustGetMembership(circle.id, userId)
    if (membership.role !== 'owner') throw new HTTPException(403, { message: '只有圈主能安装工具' })
    const tool = await getTool(slug)
    const version = tool ? await currentVersion(tool) : null
    if (!tool || !version) throw new HTTPException(404, { message: '工具不存在或还没上架' })
    const manifest = version.manifest as ToolManifest
    await db
      .insert(circleTools)
      .values({ circleId: circle.id, toolId: tool.id, installedBy: userId, scopes: manifest.permissions })
      .onConflictDoUpdate({
        target: [circleTools.circleId, circleTools.toolId],
        set: { scopes: manifest.permissions },
      })
    await touchCircle(circle.id)
    return c.json({ installed: true }, 201)
  })

  .delete('/:id/tools/:slug', slugParam, async (c) => {
    const userId = c.get('user')!.id
    const { id, slug } = c.req.valid('param')
    const circle = await mustGetCircle(id)
    const membership = await mustGetMembership(circle.id, userId)
    if (membership.role !== 'owner') throw new HTTPException(403, { message: '只有圈主能卸载工具' })
    const tool = await getTool(slug)
    if (!tool) throw new HTTPException(404, { message: '工具不存在' })
    await db.transaction(async (tx) => {
      await tx
        .delete(circleTools)
        .where(and(eq(circleTools.circleId, circle.id), eq(circleTools.toolId, tool.id)))
      await tx
        .delete(toolStorage)
        .where(and(eq(toolStorage.circleId, circle.id), eq(toolStorage.toolId, tool.id)))
    })
    return c.json({ removed: true })
  })

  .post('/:id/tools/:slug/token', slugParam, async (c) => {
    const me = c.get('user')!
    const { id, slug } = c.req.valid('param')
    const circle = await mustGetCircle(id)
    await mustGetMembership(circle.id, me.id)

    let toolId: string
    let scopes: ToolScope[]
    let info: { slug: string; name: string; version: string }
    let entryUrl: string
    let dev = false
    if (slug === DEV_TOOL_SLUG) {
      const session = await devSession(me.id, circle.id)
      if (!session) throw new HTTPException(404, { message: '没有进行中的本地开发会话' })
      toolId = session.toolId
      scopes = session.manifest.permissions
      info = { slug: session.tool.slug, name: session.manifest.name, version: session.manifest.version }
      entryUrl = new URL(session.manifest.entry, session.url.endsWith('/') ? session.url : `${session.url}/`).href
      dev = true
    } else {
      const tool = await getTool(slug)
      const version = tool ? await currentVersion(tool) : null
      if (!tool || !version) throw new HTTPException(404, { message: '工具不存在或还没上架' })
      const installed = await db
        .select()
        .from(circleTools)
        .where(and(eq(circleTools.circleId, circle.id), eq(circleTools.toolId, tool.id)))
        .limit(1)
      if (!installed[0]) throw new HTTPException(404, { message: '这个圈没有装这个工具' })
      toolId = tool.id
      scopes = installed[0].scopes as ToolScope[]
      info = { slug: tool.slug, name: tool.name, version: version.version }
      entryUrl = `${env.TOOL_ORIGIN}/t/${tool.slug}/`
    }

    const { token, expiresAt } = await issueToolToken({
      sub: me.id,
      cid: circle.id,
      tid: toolId,
      scopes,
      dev,
    })
    return c.json({
      token,
      expiresAt,
      context: {
        user: { id: me.id, name: me.name },
        circle: { id: circle.id, name: circle.name },
        tool: info,
        scopes,
        apiUrl: env.BETTER_AUTH_URL,
        entryUrl,
        origin: new URL(entryUrl).origin,
      },
    })
  })
