import { and, eq } from 'drizzle-orm'
import { strFromU8 } from 'fflate'
import { HTTPException } from 'hono/http-exception'
import type { ToolManifest } from '@harth/shared'
import { db } from '../db'
import { tools, toolVersions } from '../db/schema'
import { env } from '../env'
import {
  isTextFile,
  openPackage,
  PackageError,
  runChecks,
  type CheckResult,
  type ToolPackage,
} from './package'
import { validateBackend } from './executor'
import { aiReview, type AiVerdict } from './review'
import { backendHash } from './runs'
import { checkSchedules } from './schedules'
import { loadPackageFiles, savePackage } from './store'

export interface ReviewRecord {
  [key: string]: unknown
  checks: CheckResult[]
  ai?: AiVerdict & { model: string }
  error?: string
  admin?: { decision: 'approve' | 'reject'; note?: string; by: string; at: string }
  decidedBy?: 'checks' | 'ai' | 'admin'
}

export type ToolRow = typeof tools.$inferSelect
export type ToolVersionRow = typeof toolVersions.$inferSelect

export function allowedOrigins(): string[] {
  return [env.TOOL_ORIGIN, env.WEB_URL, env.BETTER_AUTH_URL]
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export async function getTool(slug: string): Promise<ToolRow | null> {
  const rows = await db.select().from(tools).where(eq(tools.slug, slug)).limit(1)
  return rows[0] ?? null
}

export async function getVersion(id: string): Promise<ToolVersionRow | null> {
  const rows = await db.select().from(toolVersions).where(eq(toolVersions.id, id)).limit(1)
  return rows[0] ?? null
}

export async function currentVersion(tool: ToolRow): Promise<ToolVersionRow | null> {
  if (!tool.currentVersionId) return null
  return getVersion(tool.currentVersionId)
}

// 名字只在版本通过并成为当前版本时更新，发布时不改
export async function ensureTool(userId: string, slug: string, name: string): Promise<ToolRow> {
  const existing = await getTool(slug)
  if (existing) {
    if (existing.ownerId !== userId) {
      throw new HTTPException(403, { message: `slug「${slug}」已经被别人用了` })
    }
    return existing
  }
  const [created] = await db.insert(tools).values({ slug, name, ownerId: userId }).returning()
  return created!
}

export async function publish(
  userId: string,
  zip: Uint8Array,
): Promise<{ tool: ToolRow; version: ToolVersionRow }> {
  let pkg: ToolPackage
  try {
    pkg = openPackage(zip)
  } catch (err) {
    if (err instanceof PackageError) throw new HTTPException(400, { message: err.message })
    throw err
  }
  const tool = await ensureTool(userId, pkg.manifest.slug, pkg.manifest.name)
  const dup = await db
    .select({ id: toolVersions.id })
    .from(toolVersions)
    .where(and(eq(toolVersions.toolId, tool.id), eq(toolVersions.version, pkg.manifest.version)))
    .limit(1)
  if (dup[0]) {
    throw new HTTPException(409, { message: `版本 ${pkg.manifest.version} 已经发布过，改一下版本号` })
  }

  const checks = runChecks(pkg, allowedOrigins())
  if (pkg.manifest.schedules.length > 0) {
    const problem = checkSchedules(pkg.manifest.schedules)
    checks.push({ name: '时间表', ok: problem === null, detail: problem ?? undefined })
  }
  const backendFile = pkg.manifest.backend ? pkg.files[pkg.manifest.backend] : undefined
  let hash: string | null = null
  if (pkg.manifest.backend && backendFile && checks.every((c) => c.ok)) {
    hash = backendHash(backendFile)
    const problem = await validateBackend(
      strFromU8(backendFile),
      pkg.manifest.backend,
      pkg.manifest.actions.map((a) => a.name),
    )
    checks.push({ name: '后端代码', ok: problem === null, detail: problem ?? undefined })
  }
  const failed = checks.some((c) => !c.ok)
  const review: ReviewRecord = failed ? { checks, decidedBy: 'checks' } : { checks }
  const [version] = await db
    .insert(toolVersions)
    .values({
      toolId: tool.id,
      version: pkg.manifest.version,
      manifest: pkg.manifest,
      status: failed ? 'rejected' : 'pending',
      review,
      backendHash: hash,
      reviewedAt: failed ? new Date() : null,
    })
    .returning()
  await savePackage(tool.id, version!.id, pkg.files)
  if (!failed) void runAiReview(version!.id, pkg)
  return { tool, version: version! }
}

async function runAiReview(versionId: string, pkg: ToolPackage): Promise<void> {
  try {
    const verdict = await aiReview(pkg)
    if (!verdict) return
    await applyAiVerdict(versionId, verdict)
  } catch (err) {
    console.error('[tools] 审核出错', err)
    const version = await getVersion(versionId)
    if (!version) return
    const review = (version.review ?? {}) as ReviewRecord
    await db
      .update(toolVersions)
      .set({ review: { ...review, error: err instanceof Error ? err.message : String(err) } })
      .where(eq(toolVersions.id, versionId))
  }
}

async function applyAiVerdict(versionId: string, verdict: AiVerdict): Promise<void> {
  const version = await getVersion(versionId)
  if (!version || version.status !== 'pending') return
  const review: ReviewRecord = {
    ...((version.review ?? { checks: [] }) as ReviewRecord),
    ai: { ...verdict, model: env.REVIEW?.model ?? '' },
  }
  delete review.error
  if (verdict.verdict === 'approve') {
    await approveVersion(version, { ...review, decidedBy: 'ai' })
  } else if (verdict.verdict === 'reject') {
    await rejectVersion(version, { ...review, decidedBy: 'ai' })
  } else {
    await db.update(toolVersions).set({ review }).where(eq(toolVersions.id, version.id))
  }
}

async function approveVersion(version: ToolVersionRow, review: ReviewRecord): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(toolVersions)
      .set({ status: 'approved', review, reviewedAt: new Date() })
      .where(eq(toolVersions.id, version.id))
    const [tool] = await tx.select().from(tools).where(eq(tools.id, version.toolId)).limit(1)
    if (!tool) return
    const current = tool.currentVersionId ? await getVersion(tool.currentVersionId) : null
    if (!current || compareVersions(version.version, current.version) >= 0) {
      const manifest = version.manifest as ToolManifest
      await tx.update(tools).set({ currentVersionId: version.id, name: manifest.name }).where(eq(tools.id, tool.id))
    }
  })
}

// 拒掉的是当前上架版本时，退回版本号最大的其他已通过版本，没有就下架
async function rejectVersion(version: ToolVersionRow, review: ReviewRecord): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(toolVersions)
      .set({ status: 'rejected', review, reviewedAt: new Date() })
      .where(eq(toolVersions.id, version.id))
    const [tool] = await tx.select().from(tools).where(eq(tools.id, version.toolId)).limit(1)
    if (!tool || tool.currentVersionId !== version.id) return
    const approved = await tx
      .select()
      .from(toolVersions)
      .where(and(eq(toolVersions.toolId, tool.id), eq(toolVersions.status, 'approved')))
    const fallback = approved.sort((a, b) => compareVersions(b.version, a.version))[0]
    await tx.update(tools).set({ currentVersionId: fallback?.id ?? null }).where(eq(tools.id, tool.id))
  })
}

export interface PackageFileView {
  name: string
  size: number
  text?: string
}

export async function listFiles(
  version: ToolVersionRow,
  maxTextBytes: number,
): Promise<{ files: PackageFileView[]; truncated: boolean }> {
  const all = await loadPackageFiles(version.toolId, version.id)
  const files: PackageFileView[] = []
  let used = 0
  let truncated = false
  for (const name of Object.keys(all).sort()) {
    const data = all[name]!
    const file: PackageFileView = { name, size: data.byteLength }
    if (isTextFile(name)) {
      if (used + data.byteLength <= maxTextBytes) {
        file.text = strFromU8(data)
        used += data.byteLength
      } else {
        truncated = true
      }
    }
    files.push(file)
  }
  return { files, truncated }
}

export async function adminDecide(
  adminId: string,
  versionId: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<ToolVersionRow> {
  const version = await getVersion(versionId)
  if (!version) throw new HTTPException(404, { message: '版本不存在' })
  const previous = (version.review ?? { checks: [] }) as ReviewRecord
  if (decision === 'approve' && previous.checks.some((c) => !c.ok)) {
    throw new HTTPException(409, { message: '自动检查没通过的版本不能通过，请修好后重新发布' })
  }
  const review: ReviewRecord = {
    ...previous,
    admin: { decision, note, by: adminId, at: new Date().toISOString() },
    decidedBy: 'admin',
  }
  if (decision === 'approve') await approveVersion(version, review)
  else await rejectVersion(version, review)
  return (await getVersion(versionId))!
}

export async function rereview(version: ToolVersionRow): Promise<void> {
  if (version.status !== 'pending') {
    throw new HTTPException(409, { message: '只有待审的版本可以重新审核' })
  }
  const files = await loadPackageFiles(version.toolId, version.id)
  const pkg: ToolPackage = { manifest: version.manifest as ToolManifest, files }
  await runAiReview(version.id, pkg)
}
