import { createHash } from 'node:crypto'
import { and, asc, desc, eq, lt, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  TOOL_API_OPS,
  TOOL_RUN_LIMITS,
  toolManifestSchema,
  type ToolManifest,
  type ToolRunErrorCode,
  type ToolRunTrigger,
  type ToolScope,
} from '@harth/shared'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { circles, circleTools, toolDevSessions, toolRuns, tools, toolVersions } from '../db/schema'
import { env, isAdmin } from '../env'
import { executeAction, type Bridge } from './executor'
import type { GuestContext } from './executor/protocol'
import { readPackageFile } from './store'
import { issueToolToken } from './token'

export type ToolRunRow = typeof toolRuns.$inferSelect

const KEEP_PER_INSTALL = 100
const KEEP_PROD_MS = 30 * 24 * 60 * 60 * 1000
const KEEP_DEV_MS = 24 * 60 * 60 * 1000
const MISSED_GRACE_MS = 30 * 60 * 1000
const TERMINAL: ToolRunRow['status'][] = ['ok', 'error', 'timeout', 'skipped', 'interrupted']

interface ApiLike {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>
}

let toolApi: ApiLike | null = null

export function configureToolRuns(api: ApiLike): void {
  toolApi = api
}

export function backendHash(code: string | Uint8Array): string {
  return createHash('sha256').update(code).digest('hex')
}

export function manifestOf(raw: unknown): ToolManifest {
  return toolManifestSchema.parse(raw)
}

export class RunError extends Error {
  constructor(
    public code: ToolRunErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface CreateRunInput {
  toolId: string
  circleId: string
  versionId: string | null
  environment: 'prod' | 'dev'
  trigger: ToolRunTrigger
  action: string
  input: unknown
  userId: string | null
}

export async function queuedCount(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(toolRuns)
    .where(eq(toolRuns.status, 'queued'))
  return row?.value ?? 0
}

export async function createRun(input: CreateRunInput): Promise<ToolRunRow> {
  const [row] = await db
    .insert(toolRuns)
    .values({ ...input, status: 'queued' })
    .returning()
  nudgeRuns()
  return row!
}

const waiters = new Map<string, ((run: ToolRunRow) => void)[]>()

export async function waitForRun(id: string, timeoutMs: number): Promise<ToolRunRow> {
  const current = await getRun(id)
  if (!current) throw new Error('运行记录不存在')
  if (TERMINAL.includes(current.status)) return current
  return new Promise((resolve) => {
    const list = waiters.get(id) ?? []
    const timer = setTimeout(() => {
      const remaining = (waiters.get(id) ?? []).filter((w) => w !== done)
      if (remaining.length > 0) waiters.set(id, remaining)
      else waiters.delete(id)
      void getRun(id).then((row) => resolve(row ?? current))
    }, timeoutMs)
    const done = (run: ToolRunRow) => {
      clearTimeout(timer)
      resolve(run)
    }
    list.push(done)
    waiters.set(id, list)
  })
}

export async function getRun(id: string): Promise<ToolRunRow | null> {
  const rows = await db.select().from(toolRuns).where(eq(toolRuns.id, id)).limit(1)
  return rows[0] ?? null
}

// 一次运行用哪份代码、以什么身份、带哪些权限
interface Resolved {
  manifest: ToolManifest
  code: string
  file: string
  scopes: ToolScope[]
  token: string
}

async function resolveRun(run: ToolRunRow, tool: typeof tools.$inferSelect): Promise<Resolved> {
  if (run.environment === 'dev') {
    if (!run.userId) throw new RunError('FORBIDDEN', '开发运行需要开发者身份')
    const [session] = await db
      .select()
      .from(toolDevSessions)
      .where(and(eq(toolDevSessions.userId, run.userId), eq(toolDevSessions.toolId, tool.id), eq(toolDevSessions.circleId, run.circleId)))
      .limit(1)
    if (!session || session.expiresAt < new Date()) throw new RunError('FORBIDDEN', '开发会话已结束')
    const manifest = manifestOf(session.manifest)
    if (!manifest.backend || !session.backend) throw new RunError('ACTION_MISSING', '开发会话没有上传后端代码')
    const { token } = await issueToolToken({
      sub: run.userId,
      cid: run.circleId,
      tid: tool.id,
      scopes: manifest.permissions,
      dev: true,
      by: run.trigger === 'schedule' ? 'tool' : undefined,
    })
    return { manifest, code: session.backend, file: manifest.backend, scopes: manifest.permissions, token }
  }

  if (!run.versionId) throw new RunError('ACTION_MISSING', '这个工具还没有上架的版本')
  const [version] = await db.select().from(toolVersions).where(eq(toolVersions.id, run.versionId)).limit(1)
  if (!version) throw new RunError('ACTION_MISSING', '版本不存在')
  const manifest = manifestOf(version.manifest)
  if (!manifest.backend) throw new RunError('ACTION_MISSING', '这个版本没有后端代码')
  const bytes = await readPackageFile(tool.id, version.id, manifest.backend)
  if (!bytes) throw new RunError('ACTION_MISSING', '后端文件不存在')
  if (!version.backendHash || backendHash(bytes) !== version.backendHash) {
    throw new RunError('HOST_ERROR', '后端代码与审核时不一致')
  }
  const code = bytes.toString('utf8')

  if (version.id === tool.currentVersionId) {
    const [install] = await db
      .select()
      .from(circleTools)
      .where(and(eq(circleTools.circleId, run.circleId), eq(circleTools.toolId, tool.id)))
      .limit(1)
    if (!install) throw new RunError('FORBIDDEN', '这个圈没有安装这个工具')
    const scopes = install.scopes as ToolScope[]
    const { token } = await issueToolToken({
      sub: run.userId ?? '',
      cid: run.circleId,
      tid: tool.id,
      scopes,
      by: run.trigger === 'schedule' ? 'tool' : undefined,
      inst: install.installedAt.getTime(),
    })
    return { manifest, code, file: manifest.backend, scopes, token }
  }

  // 不是当前上架版本：只有管理员在审核页试运行时才会走到这里
  const [admin] = run.userId
    ? await db.select({ email: user.email }).from(user).where(eq(user.id, run.userId)).limit(1)
    : []
  if (!admin || !isAdmin(admin)) throw new RunError('FORBIDDEN', '这个版本还没上架')
  const { token } = await issueToolToken({
    sub: run.userId!,
    cid: run.circleId,
    tid: tool.id,
    scopes: manifest.permissions,
    review: true,
    vid: version.id,
  })
  return { manifest, code, file: manifest.backend, scopes: manifest.permissions, token }
}

function bridgeFor(token: string): Bridge {
  return async (op, args) => {
    const route = TOOL_API_OPS[op]
    if (!route || !toolApi) return { status: 400, body: { error: '不支持的操作' } }
    const body = route.body?.(...args)
    const res = await toolApi.request(`/api/tool${route.path(...args)}`, {
      method: route.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
}

async function executeRun(run: ToolRunRow): Promise<void> {
  const startedAt = Date.now()
  let outcome: { ok: boolean; result?: unknown; errorCode?: ToolRunErrorCode; error?: string; logs: string; durationMs: number }
  try {
    const [tool] = await db.select().from(tools).where(eq(tools.id, run.toolId)).limit(1)
    const [circle] = await db.select().from(circles).where(eq(circles.id, run.circleId)).limit(1)
    if (!tool || !circle) throw new RunError('FORBIDDEN', '工具或圈子不存在')
    if (circle.archivedAt) throw new RunError('FORBIDDEN', '圈子已归档')
    const resolved = await resolveRun(run, tool)
    const action = resolved.manifest.actions.find((a) => a.name === run.action)
    if (!action) throw new RunError('ACTION_MISSING', `清单里没有动作 ${run.action}`)
    if (run.trigger !== 'manual' && !action.triggers.includes(run.trigger)) {
      throw new RunError('FORBIDDEN', `动作 ${run.action} 不允许${run.trigger === 'call' ? '前端调用' : '定时触发'}`)
    }
    const [who] = run.userId && run.trigger !== 'schedule'
      ? await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, run.userId)).limit(1)
      : []
    const context: GuestContext = {
      user: who ?? null,
      circle: { id: circle.id, name: circle.name },
      tool: { slug: tool.slug, name: resolved.manifest.name, version: resolved.manifest.version },
      scopes: resolved.scopes,
      trigger: run.trigger,
    }
    outcome = await executeAction({
      code: resolved.code,
      file: resolved.file,
      action: run.action,
      input: run.input,
      context,
      bridge: bridgeFor(resolved.token),
    })
  } catch (err) {
    const failure = err instanceof RunError ? err : new RunError('HOST_ERROR', err instanceof Error ? err.message : String(err))
    outcome = { ok: false, errorCode: failure.code, error: failure.message, logs: '', durationMs: Date.now() - startedAt }
  }
  const status: ToolRunRow['status'] = outcome.ok ? 'ok' : outcome.errorCode === 'TIMEOUT' ? 'timeout' : 'error'
  const [updated] = await db
    .update(toolRuns)
    .set({
      status,
      errorCode: outcome.errorCode ?? null,
      error: outcome.error ?? null,
      logs: outcome.logs || null,
      result: outcome.ok ? (outcome.result ?? null) : null,
      finishedAt: new Date(),
      durationMs: outcome.durationMs,
    })
    .where(eq(toolRuns.id, run.id))
    .returning()
  const final = updated ?? run
  for (const waiter of waiters.get(run.id) ?? []) waiter(final)
  waiters.delete(run.id)
  await prune(run.toolId, run.circleId, run.environment)
}

async function prune(toolId: string, circleId: string, environment: 'prod' | 'dev'): Promise<void> {
  const cutoff = new Date(Date.now() - (environment === 'dev' ? KEEP_DEV_MS : KEEP_PROD_MS))
  await db
    .delete(toolRuns)
    .where(and(eq(toolRuns.toolId, toolId), eq(toolRuns.circleId, circleId), eq(toolRuns.environment, environment), lt(toolRuns.createdAt, cutoff)))
  const keep = await db
    .select({ id: toolRuns.id })
    .from(toolRuns)
    .where(and(eq(toolRuns.toolId, toolId), eq(toolRuns.circleId, circleId), eq(toolRuns.environment, environment)))
    .orderBy(desc(toolRuns.createdAt))
    .limit(KEEP_PER_INSTALL)
  const last = keep[keep.length - 1]
  if (keep.length < KEEP_PER_INSTALL || !last) return
  const [oldest] = await db.select({ createdAt: toolRuns.createdAt }).from(toolRuns).where(eq(toolRuns.id, last.id)).limit(1)
  if (!oldest) return
  await db
    .delete(toolRuns)
    .where(and(eq(toolRuns.toolId, toolId), eq(toolRuns.circleId, circleId), eq(toolRuns.environment, environment), lt(toolRuns.createdAt, oldest.createdAt)))
}

// 同一个 工具 × 圈 同时只跑一个；多实例靠 SKIP LOCKED 不抢同一条
async function claimNext(): Promise<ToolRunRow | null> {
  return db.transaction(async (tx) => {
    const running = alias(toolRuns, 'running')
    const [candidate] = await tx
      .select({ id: toolRuns.id })
      .from(toolRuns)
      .where(
        and(
          eq(toolRuns.status, 'queued'),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(running)
              .where(and(eq(running.status, 'running'), eq(running.toolId, toolRuns.toolId), eq(running.circleId, toolRuns.circleId))),
          ),
        ),
      )
      .orderBy(asc(toolRuns.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!candidate) return null
    const [claimed] = await tx
      .update(toolRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(toolRuns.id, candidate.id))
      .returning()
    return claimed ?? null
  })
}

let inFlight = 0
let pumping = false
let loopStarted = false

export function nudgeRuns(): void {
  if (!env.TOOL_RUNS || pumping) return
  void pump()
}

async function pump(): Promise<void> {
  pumping = true
  try {
    while (inFlight < TOOL_RUN_LIMITS.concurrency) {
      const run = await claimNext()
      if (!run) break
      inFlight++
      void executeRun(run)
        .catch((err) => console.error('[tools] 运行失败', err))
        .finally(() => {
          inFlight--
          nudgeRuns()
        })
    }
  } catch (err) {
    console.error('[tools] 领取运行失败', err)
  } finally {
    pumping = false
  }
}

// 进程启动时：上次没跑完的记为中断，过期太久的定时运行跳过
export async function startRunLoop(): Promise<void> {
  if (loopStarted) return
  loopStarted = true
  const now = new Date()
  await db
    .update(toolRuns)
    .set({ status: 'interrupted', errorCode: 'HOST_ERROR', error: '平台重启，运行被中断', finishedAt: now })
    .where(eq(toolRuns.status, 'running'))
  await db
    .update(toolRuns)
    .set({ status: 'skipped', errorCode: 'TIMEOUT', error: '错过了计划时间', finishedAt: now })
    .where(and(eq(toolRuns.status, 'queued'), eq(toolRuns.trigger, 'schedule'), lt(toolRuns.scheduledFor, new Date(now.getTime() - MISSED_GRACE_MS))))
  nudgeRuns()
  setInterval(nudgeRuns, 5_000).unref()
}
