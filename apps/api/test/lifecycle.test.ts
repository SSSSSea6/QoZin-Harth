import { RENEWAL_WINDOW_DAYS } from '@harth/shared'
import { describe, expect, it } from 'vitest'
import { planSweep, transition } from '../src/domain/lifecycle'

const DAY = 24 * 60 * 60 * 1000
const base = new Date('2026-09-01T00:00:00Z')
const days = (n: number) => new Date(base.getTime() + n * DAY)

function row(overrides: Partial<Parameters<typeof transition>[0]> = {}) {
  return {
    id: 'c1',
    dormancyDays: 30,
    lastActivityAt: base,
    hibernationDeadline: null,
    archivedAt: null,
    ...overrides,
  }
}

describe('圈子生命周期', () => {
  it('活跃圈不动', () => {
    expect(transition(row(), days(10))).toBeNull()
  })

  it('沉寂超过阈值进入休眠倒计时，窗口为续期期限', () => {
    const action = transition(row(), days(31))
    expect(action).toEqual({
      kind: 'hibernate',
      id: 'c1',
      deadline: new Date(days(31).getTime() + RENEWAL_WINDOW_DAYS * DAY),
    })
  })

  it('倒计时内出现新活动则解除（兜底 wake）', () => {
    const action = transition(
      row({ lastActivityAt: days(30), hibernationDeadline: days(38) }),
      days(31),
    )
    expect(action).toEqual({ kind: 'wake', id: 'c1' })
  })

  it('倒计时到期无人添柴则归档', () => {
    const action = transition(
      row({ hibernationDeadline: days(38) }),
      days(38),
    )
    expect(action).toEqual({ kind: 'archive', id: 'c1' })
  })

  it('倒计时未到期且仍沉寂则等待', () => {
    expect(
      transition(row({ hibernationDeadline: days(38) }), days(35)),
    ).toBeNull()
  })

  it('官方圈（无沉寂阈值）与已归档圈不参与', () => {
    expect(transition(row({ dormancyDays: null }), days(999))).toBeNull()
    expect(
      transition(row({ archivedAt: days(1) }), days(999)),
    ).toBeNull()
  })

  it('planSweep 汇总多圈动作', () => {
    const actions = planSweep(
      [row(), row({ id: 'c2', hibernationDeadline: days(20) })],
      days(31),
    )
    expect(actions.map((a) => a.kind).sort()).toEqual(['archive', 'hibernate'])
  })
})
