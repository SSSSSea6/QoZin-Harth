import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { circles } from '../db/schema'
import { planSweep } from '../domain/lifecycle'
import { notify } from '../domain/notify'

export interface SweepResult {
  hibernated: number
  woken: number
  archived: number
}

export async function runSweep(now: Date): Promise<SweepResult> {
  const rows = await db
    .select({
      id: circles.id,
      dormancyDays: circles.dormancyDays,
      lastActivityAt: circles.lastActivityAt,
      hibernationDeadline: circles.hibernationDeadline,
      archivedAt: circles.archivedAt,
    })
    .from(circles)
    .where(and(isNull(circles.archivedAt), isNotNull(circles.dormancyDays)))

  const actions = planSweep(rows, now)
  const result: SweepResult = { hibernated: 0, woken: 0, archived: 0 }

  for (const action of actions) {
    if (action.kind === 'hibernate') {
      // 只对真正从"活跃"跳到"倒计时"的那一行发通知；并发巡查或刚添过柴的圈不会重复
      const changed = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(circles)
          .set({ hibernationDeadline: action.deadline })
          .where(
            and(
              eq(circles.id, action.id),
              isNull(circles.archivedAt),
              isNull(circles.hibernationDeadline),
              sql`${circles.lastActivityAt} + ${circles.dormancyDays} * interval '1 day' < ${now}`,
            ),
          )
          .returning({ id: circles.id, name: circles.name, deadline: circles.hibernationDeadline })
        if (!row) return false
        await notify(tx, {
          kind: 'circle_dying',
          eventKey: `dying:${row.id}:${row.deadline!.toISOString()}`,
          circleId: row.id,
          refType: 'circle',
          refId: row.id,
          title: `「${row.name}」快熄了`,
          body: '没人添柴就会散场，去看看吧',
          circleMembersOf: row.id,
        })
        return true
      })
      if (changed) result.hibernated++
    } else if (action.kind === 'wake') {
      await db
        .update(circles)
        .set({ hibernationDeadline: null })
        .where(eq(circles.id, action.id))
      result.woken++
    } else {
      await db
        .update(circles)
        .set({ archivedAt: now, hibernationDeadline: null })
        .where(and(eq(circles.id, action.id), isNull(circles.archivedAt)))
      result.archived++
    }
  }
  return result
}
