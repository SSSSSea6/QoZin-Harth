import {
  billingDay,
  billingMonth,
  FUEL_ALLOWANCE,
  FUEL_RATE_VERSION,
  FUEL_RUN_RESERVE,
  fuelForHolding,
  fuelForRun,
  TOOL_STORAGE_OWNER_MAX_BYTES,
} from '@harth/shared'
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { developers, fuelAccounts, toolRuns, tools, toolStorage, toolUsage, toolVersions } from '../db/schema'

// db 或事务里的执行器
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

type RunRow = typeof toolRuns.$inferSelect

export const TERMINAL_RUN_STATUSES: RunRow['status'][] = ['ok', 'error', 'timeout', 'skipped', 'interrupted']
const TERMINAL = TERMINAL_RUN_STATUSES
const EXECUTED: RunRow['status'][] = ['ok', 'error', 'timeout']

export interface UsageDelta {
  runs?: number
  ok?: number
  failed?: number
  skipped?: number
  runMs?: number
  posts?: number
  storageWrites?: number
  storageWriteBytes?: number
  units?: number
}

export async function allowanceFor(x: Executor, ownerId: string): Promise<number> {
  const [dev] = await x
    .select({ revokedAt: developers.revokedAt })
    .from(developers)
    .where(eq(developers.userId, ownerId))
    .limit(1)
  return dev && !dev.revokedAt ? FUEL_ALLOWANCE.developer : FUEL_ALLOWANCE.basic
}

export async function ownerOfTool(x: Executor, toolId: string): Promise<string> {
  const [tool] = await x.select({ ownerId: tools.ownerId }).from(tools).where(eq(tools.id, toolId)).limit(1)
  if (!tool) throw new Error('工具不存在')
  return tool.ownerId
}

async function addUsage(x: Executor, toolId: string, ownerId: string, day: string, delta: UsageDelta): Promise<void> {
  const values = {
    runs: delta.runs ?? 0,
    ok: delta.ok ?? 0,
    failed: delta.failed ?? 0,
    skipped: delta.skipped ?? 0,
    runMs: delta.runMs ?? 0,
    posts: delta.posts ?? 0,
    storageWrites: delta.storageWrites ?? 0,
    storageWriteBytes: delta.storageWriteBytes ?? 0,
    units: delta.units ?? 0,
  }
  await x
    .insert(toolUsage)
    .values({ toolId, ownerId, day, ...values })
    .onConflictDoUpdate({
      target: [toolUsage.toolId, toolUsage.day],
      set: {
        runs: sql`${toolUsage.runs} + ${values.runs}`,
        ok: sql`${toolUsage.ok} + ${values.ok}`,
        failed: sql`${toolUsage.failed} + ${values.failed}`,
        skipped: sql`${toolUsage.skipped} + ${values.skipped}`,
        runMs: sql`${toolUsage.runMs} + ${values.runMs}`,
        posts: sql`${toolUsage.posts} + ${values.posts}`,
        storageWrites: sql`${toolUsage.storageWrites} + ${values.storageWrites}`,
        storageWriteBytes: sql`${toolUsage.storageWriteBytes} + ${values.storageWriteBytes}`,
        units: sql`${toolUsage.units} + ${values.units}`,
      },
    })
}

// 原子准入：余额够就记账并返回 true；不够返回 false，什么都不改
export async function chargeFuel(
  x: Executor,
  input: { ownerId: string; toolId: string; units: number; at?: Date; usage?: UsageDelta },
): Promise<boolean> {
  const at = input.at ?? new Date()
  const month = billingMonth(at)
  const allowance = await allowanceFor(x, input.ownerId)
  if (input.units > allowance) return false
  const rows = await x
    .insert(fuelAccounts)
    .values({ ownerId: input.ownerId, month, used: input.units, rateVersion: FUEL_RATE_VERSION })
    .onConflictDoUpdate({
      target: [fuelAccounts.ownerId, fuelAccounts.month],
      set: { used: sql`${fuelAccounts.used} + ${input.units}`, updatedAt: new Date() },
      setWhere: sql`${fuelAccounts.used} + ${fuelAccounts.reserved} + ${input.units} <= ${allowance}`,
    })
    .returning({ used: fuelAccounts.used })
  if (rows.length === 0) return false
  await addUsage(x, input.toolId, input.ownerId, billingDay(at), { ...input.usage, units: input.units })
  return true
}

// 运行准入：按上限预留，结束后结算
export async function reserveRun(
  x: Executor,
  ownerId: string,
  at = new Date(),
): Promise<{ month: string; reserved: number } | null> {
  const month = billingMonth(at)
  const allowance = await allowanceFor(x, ownerId)
  const rows = await x
    .insert(fuelAccounts)
    .values({ ownerId, month, reserved: FUEL_RUN_RESERVE, rateVersion: FUEL_RATE_VERSION })
    .onConflictDoUpdate({
      target: [fuelAccounts.ownerId, fuelAccounts.month],
      set: { reserved: sql`${fuelAccounts.reserved} + ${FUEL_RUN_RESERVE}`, updatedAt: new Date() },
      setWhere: sql`${fuelAccounts.used} + ${fuelAccounts.reserved} + ${FUEL_RUN_RESERVE} <= ${allowance}`,
    })
    .returning({ month: fuelAccounts.month })
  return rows[0] ? { month, reserved: FUEL_RUN_RESERVE } : null
}

// 预留了却没有真正排进队列（比如重复的定时发生次）时退回
export async function releaseReservation(x: Executor, ownerId: string, month: string, units: number): Promise<void> {
  await x
    .update(fuelAccounts)
    .set({ reserved: sql`GREATEST(${fuelAccounts.reserved} - ${units}, 0)`, updatedAt: new Date() })
    .where(and(eq(fuelAccounts.ownerId, ownerId), eq(fuelAccounts.month, month)))
}

// 结算一次运行：幂等，同一条只结一次；没预留的（试运行）只记统计不收费
export async function settleRun(x: Executor, run: RunRow): Promise<void> {
  const executed = EXECUTED.includes(run.status)
  const charge = executed && run.fuelReserved !== null ? fuelForRun(run.durationMs ?? 0) : 0
  const [marked] = await x
    .update(toolRuns)
    .set({ fuelCharged: charge })
    .where(and(eq(toolRuns.id, run.id), isNull(toolRuns.fuelCharged)))
    .returning({ id: toolRuns.id })
  if (!marked) return
  const ownerId = await ownerOfTool(x, run.toolId)
  if (run.fuelMonth && run.fuelReserved !== null) {
    await x
      .update(fuelAccounts)
      .set({
        used: sql`${fuelAccounts.used} + ${charge}`,
        reserved: sql`GREATEST(${fuelAccounts.reserved} - ${run.fuelReserved}, 0)`,
        updatedAt: new Date(),
      })
      .where(and(eq(fuelAccounts.ownerId, ownerId), eq(fuelAccounts.month, run.fuelMonth)))
  }
  await addUsage(x, run.toolId, ownerId, billingDay(run.startedAt ?? run.createdAt), {
    runs: executed ? 1 : 0,
    ok: run.status === 'ok' ? 1 : 0,
    failed: run.status === 'error' || run.status === 'timeout' || run.status === 'interrupted' ? 1 : 0,
    skipped: run.status === 'skipped' ? 1 : 0,
    runMs: executed ? (run.durationMs ?? 0) : 0,
    units: charge,
  })
}

// 定时运行因额度被跳过时只记一笔统计
export async function recordSkipped(x: Executor, toolId: string, ownerId: string, at = new Date()): Promise<void> {
  await addUsage(x, toolId, ownerId, billingDay(at), { skipped: 1 })
}

// 进程启动时把已到终态但没结算的运行补结（结算与终态之间崩溃过）
export async function reconcileFuel(): Promise<number> {
  const rows = await db
    .select()
    .from(toolRuns)
    .where(and(isNotNull(toolRuns.fuelReserved), isNull(toolRuns.fuelCharged), inArray(toolRuns.status, TERMINAL)))
  for (const run of rows) {
    await db.transaction((tx) => settleRun(tx, run))
  }
  return rows.length
}

// 每天一次：按逻辑占用（存储值 + 已发布的包）记持有费；同一天只记一次
export async function chargeHolding(now = new Date()): Promise<{ owners: number; units: number }> {
  const day = billingDay(now)
  const month = billingMonth(now)
  const storage = await db
    .select({
      toolId: toolStorage.toolId,
      bytes: sql<number>`coalesce(sum(octet_length(${toolStorage.value}::text)), 0)`.mapWith(Number),
    })
    .from(toolStorage)
    .groupBy(toolStorage.toolId)
  const packages = await db
    .select({
      toolId: toolVersions.toolId,
      bytes: sql<number>`coalesce(sum(${toolVersions.packageBytes}), 0)`.mapWith(Number),
    })
    .from(toolVersions)
    .groupBy(toolVersions.toolId)
  const byTool = new Map<string, number>()
  for (const row of [...storage, ...packages]) {
    if (row.bytes > 0) byTool.set(row.toolId, (byTool.get(row.toolId) ?? 0) + row.bytes)
  }
  if (byTool.size === 0) return { owners: 0, units: 0 }
  const owners = await db
    .select({ id: tools.id, ownerId: tools.ownerId })
    .from(tools)
    .where(inArray(tools.id, [...byTool.keys()]))
  const byOwner = new Map<string, { toolId: string; bytes: number }[]>()
  for (const tool of owners) {
    const list = byOwner.get(tool.ownerId) ?? []
    list.push({ toolId: tool.id, bytes: byTool.get(tool.id) ?? 0 })
    byOwner.set(tool.ownerId, list)
  }
  const result = { owners: 0, units: 0 }
  for (const [ownerId, list] of byOwner) {
    const bytes = list.reduce((sum, t) => sum + t.bytes, 0)
    const units = fuelForHolding(bytes)
    await db.transaction(async (tx) => {
      const rows = await tx
        .insert(fuelAccounts)
        .values({ ownerId, month, used: units, rateVersion: FUEL_RATE_VERSION, storageBytes: bytes, holdingBilledOn: day })
        .onConflictDoUpdate({
          target: [fuelAccounts.ownerId, fuelAccounts.month],
          set: {
            used: sql`${fuelAccounts.used} + ${units}`,
            storageBytes: bytes,
            holdingBilledOn: day,
            updatedAt: new Date(),
          },
          setWhere: sql`${fuelAccounts.holdingBilledOn} IS DISTINCT FROM ${day}`,
        })
        .returning({ month: fuelAccounts.month })
      if (rows.length === 0) return
      for (const t of list) await addUsage(tx, t.toolId, ownerId, day, { units: fuelForHolding(t.bytes) })
      result.owners++
      result.units += units
    })
  }
  return result
}

export interface ToolUsageTotals {
  runs: number
  ok: number
  failed: number
  skipped: number
  runMs: number
  posts: number
  storageWrites: number
  storageWriteBytes: number
  units: number
}

const emptyTotals = (): ToolUsageTotals => ({
  runs: 0,
  ok: 0,
  failed: 0,
  skipped: 0,
  runMs: 0,
  posts: 0,
  storageWrites: 0,
  storageWriteBytes: 0,
  units: 0,
})

export interface UsageSummary {
  month: string
  used: number
  reserved: number
  allowance: number
  storageBytes: number
  tools: Map<string, { month: ToolUsageTotals; week: ToolUsageTotals }>
}

// 本账期的账户与每个工具的本月 / 近 7 天明细
export async function usageSummary(ownerId: string, now = new Date()): Promise<UsageSummary> {
  const month = billingMonth(now)
  const [account] = await db
    .select()
    .from(fuelAccounts)
    .where(and(eq(fuelAccounts.ownerId, ownerId), eq(fuelAccounts.month, month)))
    .limit(1)
  const allowance = await allowanceFor(db, ownerId)
  const weekStart = billingDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000))
  const since = weekStart < `${month}-01` ? weekStart : `${month}-01`
  const rows = await db
    .select()
    .from(toolUsage)
    .where(and(eq(toolUsage.ownerId, ownerId), gte(toolUsage.day, since)))
  const byTool = new Map<string, { month: ToolUsageTotals; week: ToolUsageTotals }>()
  for (const row of rows) {
    const entry = byTool.get(row.toolId) ?? { month: emptyTotals(), week: emptyTotals() }
    const targets = [
      row.day.startsWith(month) ? entry.month : null,
      row.day >= weekStart ? entry.week : null,
    ]
    for (const target of targets) {
      if (!target) continue
      target.runs += row.runs
      target.ok += row.ok
      target.failed += row.failed
      target.skipped += row.skipped
      target.runMs += row.runMs
      target.posts += row.posts
      target.storageWrites += row.storageWrites
      target.storageWriteBytes += row.storageWriteBytes
      target.units += row.units
    }
    byTool.set(row.toolId, entry)
  }
  return {
    month,
    used: account?.used ?? 0,
    reserved: account?.reserved ?? 0,
    allowance,
    storageBytes: account?.storageBytes ?? 0,
    tools: byTool,
  }
}

// 存储占用上限按每日快照判断，是估算
export async function overStorageCap(ownerId: string, now = new Date()): Promise<boolean> {
  const [account] = await db
    .select({ storageBytes: fuelAccounts.storageBytes })
    .from(fuelAccounts)
    .where(and(eq(fuelAccounts.ownerId, ownerId), eq(fuelAccounts.month, billingMonth(now))))
    .limit(1)
  return (account?.storageBytes ?? 0) >= TOOL_STORAGE_OWNER_MAX_BYTES
}

export async function isOverQuota(ownerId: string, now = new Date()): Promise<boolean> {
  const month = billingMonth(now)
  const [account] = await db
    .select({ used: fuelAccounts.used, reserved: fuelAccounts.reserved })
    .from(fuelAccounts)
    .where(and(eq(fuelAccounts.ownerId, ownerId), eq(fuelAccounts.month, month)))
    .limit(1)
  if (!account) return false
  return account.used + account.reserved >= (await allowanceFor(db, ownerId))
}
