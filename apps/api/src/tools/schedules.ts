import { CronExpressionParser } from 'cron-parser'
import { and, asc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm'
import {
  TOOL_RUN_LIMITS,
  TOOL_SCHEDULE_MIN_INTERVAL_MINUTES,
  TOOL_SCHEDULE_TZ,
  type ToolManifest,
  type ToolSchedule,
  type ToolScope,
} from '@harth/shared'
import { db } from '../db'
import { circles, toolRuns, toolSchedules, tools } from '../db/schema'
import { nudgeRuns } from './runs'

const OCCURRENCES_TO_CHECK = 500
const MISSED_GRACE_MS = 30 * 60 * 1000

export function nextOccurrence(cron: string, after: Date): Date {
  return CronExpressionParser.parse(cron, { tz: TOOL_SCHEDULE_TZ, currentDate: after }).next().toDate()
}

// 往后取 500 次发生，任何相邻两次都不能少于最短间隔
export function checkSchedules(schedules: ToolSchedule[]): string | null {
  for (const schedule of schedules) {
    let expr
    try {
      expr = CronExpressionParser.parse(schedule.cron, { tz: TOOL_SCHEDULE_TZ })
    } catch {
      return `时间表 ${schedule.name} 的 cron 不合法：${schedule.cron}`
    }
    let previous = expr.next().getTime()
    for (let i = 0; i < OCCURRENCES_TO_CHECK; i++) {
      let current: number
      try {
        current = expr.next().getTime()
      } catch {
        break
      }
      if (current - previous < TOOL_SCHEDULE_MIN_INTERVAL_MINUTES * 60 * 1000) {
        return `时间表 ${schedule.name} 两次运行间隔少于 ${TOOL_SCHEDULE_MIN_INTERVAL_MINUTES} 分钟`
      }
      previous = current
    }
  }
  return null
}

export function scheduleSnapshot(manifest: ToolManifest, scopes: ToolScope[]): ToolSchedule[] {
  return scopes.includes('schedule') ? manifest.schedules : []
}

export async function syncSchedules(
  circleId: string,
  toolId: string,
  schedules: ToolSchedule[],
  now = new Date(),
): Promise<void> {
  const existing = await db
    .select()
    .from(toolSchedules)
    .where(and(eq(toolSchedules.circleId, circleId), eq(toolSchedules.toolId, toolId)))
  const byName = new Map(existing.map((row) => [row.name, row]))
  for (const schedule of schedules) {
    const current = byName.get(schedule.name)
    const values = {
      cron: schedule.cron,
      action: schedule.action,
      input: schedule.input ?? null,
      nextRunAt: nextOccurrence(schedule.cron, now),
    }
    if (!current) {
      await db.insert(toolSchedules).values({ circleId, toolId, name: schedule.name, ...values })
    } else if (current.cron !== schedule.cron || current.action !== schedule.action) {
      await db.update(toolSchedules).set(values).where(eq(toolSchedules.id, current.id))
    } else if (JSON.stringify(current.input ?? null) !== JSON.stringify(schedule.input ?? null)) {
      await db.update(toolSchedules).set({ input: schedule.input ?? null }).where(eq(toolSchedules.id, current.id))
    }
  }
  const names = schedules.map((s) => s.name)
  await db
    .delete(toolSchedules)
    .where(
      and(
        eq(toolSchedules.circleId, circleId),
        eq(toolSchedules.toolId, toolId),
        names.length > 0 ? notInArray(toolSchedules.name, names) : sql`true`,
      ),
    )
}

export async function clearSchedules(circleId: string, toolId: string): Promise<void> {
  await db
    .delete(toolSchedules)
    .where(and(eq(toolSchedules.circleId, circleId), eq(toolSchedules.toolId, toolId)))
}

// 每分钟一次：领取到期的时间表、落运行记录、把下次时间从计划时间往后推；停机错过的不补跑
export async function tickSchedules(now = new Date()): Promise<{ created: number; skipped: number }> {
  const result = { created: 0, skipped: 0 }
  await db.transaction(async (tx) => {
    const due = await tx
      .select({ schedule: toolSchedules, tool: tools, circle: circles })
      .from(toolSchedules)
      .innerJoin(tools, eq(toolSchedules.toolId, tools.id))
      .innerJoin(circles, eq(toolSchedules.circleId, circles.id))
      .where(lte(toolSchedules.nextRunAt, now))
      .orderBy(asc(toolSchedules.nextRunAt))
      .limit(100)
      .for('update', { of: toolSchedules, skipLocked: true })

    for (const { schedule, tool, circle } of due) {
      const scheduledFor = schedule.nextRunAt
      let next = nextOccurrence(schedule.cron, scheduledFor)
      if (next.getTime() <= now.getTime()) next = nextOccurrence(schedule.cron, now)
      await tx
        .update(toolSchedules)
        .set({ nextRunAt: next, lastScheduledFor: scheduledFor })
        .where(eq(toolSchedules.id, schedule.id))
      if (!tool.currentVersionId || circle.archivedAt) continue
      if (now.getTime() - scheduledFor.getTime() > MISSED_GRACE_MS) {
        result.skipped++
        continue
      }
      const [recent] = await tx
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(toolRuns)
        .where(
          and(
            eq(toolRuns.toolId, tool.id),
            eq(toolRuns.circleId, circle.id),
            eq(toolRuns.trigger, 'schedule'),
            gte(toolRuns.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
          ),
        )
      const overQuota = (recent?.value ?? 0) >= TOOL_RUN_LIMITS.scheduledRunsPerHour
      await tx
        .insert(toolRuns)
        .values({
          toolId: tool.id,
          circleId: circle.id,
          versionId: tool.currentVersionId,
          scheduleId: schedule.id,
          environment: 'prod',
          trigger: 'schedule',
          action: schedule.action,
          input: schedule.input ?? null,
          scheduledFor,
          status: overQuota ? 'skipped' : 'queued',
          errorCode: overQuota ? 'BUDGET' : null,
          error: overQuota ? `每小时最多定时运行 ${TOOL_RUN_LIMITS.scheduledRunsPerHour} 次` : null,
          finishedAt: overQuota ? now : null,
        })
        .onConflictDoNothing({ target: [toolRuns.scheduleId, toolRuns.scheduledFor] })
      if (overQuota) result.skipped++
      else result.created++
    }
  })
  if (result.created > 0) nudgeRuns()
  return result
}

// 测试与运维用：把一个安装的全部时间表设为立刻到期
export async function makeSchedulesDue(circleId: string, toolId: string, now = new Date()): Promise<number> {
  const rows = await db
    .update(toolSchedules)
    .set({ nextRunAt: now })
    .where(and(eq(toolSchedules.circleId, circleId), eq(toolSchedules.toolId, toolId)))
    .returning({ id: toolSchedules.id })
  return rows.length
}

export async function schedulesOf(circleId: string, toolIds: string[]): Promise<Map<string, (typeof toolSchedules.$inferSelect)[]>> {
  const map = new Map<string, (typeof toolSchedules.$inferSelect)[]>()
  if (toolIds.length === 0) return map
  const rows = await db
    .select()
    .from(toolSchedules)
    .where(and(eq(toolSchedules.circleId, circleId), inArray(toolSchedules.toolId, toolIds)))
  for (const row of rows) {
    const list = map.get(row.toolId) ?? []
    list.push(row)
    map.set(row.toolId, list)
  }
  return map
}
