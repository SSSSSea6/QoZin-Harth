import { RENEWAL_WINDOW_DAYS } from '@harth/shared'

const DAY_MS = 24 * 60 * 60 * 1000

export interface LifecycleRow {
  id: string
  dormancyDays: number | null
  lastActivityAt: Date
  hibernationDeadline: Date | null
  archivedAt: Date | null
}

export type LifecycleAction =
  | { kind: 'hibernate'; id: string; deadline: Date }
  | { kind: 'wake'; id: string }
  | { kind: 'archive'; id: string }

// 沉寂超过 dormancyDays 进入倒计时，倒计时内有活动则解除，到期归档。
// dormancyDays 为 null 的圈不参与。
export function transition(row: LifecycleRow, now: Date): LifecycleAction | null {
  if (row.archivedAt || row.dormancyDays === null) return null

  const dormantSince = row.lastActivityAt.getTime() + row.dormancyDays * DAY_MS

  if (row.hibernationDeadline) {
    if (now.getTime() > dormantSince) {
      return now >= row.hibernationDeadline
        ? { kind: 'archive', id: row.id }
        : null
    }
    // 倒计时期间有了新活动；写路径通常已清掉倒计时，这里兜底
    return { kind: 'wake', id: row.id }
  }

  if (now.getTime() > dormantSince) {
    return {
      kind: 'hibernate',
      id: row.id,
      deadline: new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS),
    }
  }
  return null
}

export function planSweep(rows: LifecycleRow[], now: Date): LifecycleAction[] {
  const actions: LifecycleAction[] = []
  for (const row of rows) {
    const action = transition(row, now)
    if (action) actions.push(action)
  }
  return actions
}
