import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db'
import { circles } from '../db/schema'
import { planSweep } from '../domain/lifecycle'

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
      await db
        .update(circles)
        .set({ hibernationDeadline: action.deadline })
        .where(and(eq(circles.id, action.id), isNull(circles.archivedAt)))
      result.hibernated++
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
