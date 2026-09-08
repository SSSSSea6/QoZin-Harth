import { PHONE_ERROR_CODES } from '@harth/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { userRestrictions } from '../db/schema'
import { env } from '../env'
import { fail } from '../http'

export interface UserState {
  phoneVerified: boolean
  restriction: { kind: 'mute' | 'ban'; until: Date | null; reason: string } | null
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

// 发言、封禁、禁言的判断都从这一处读当前状态
export async function userState(x: Executor, userId: string): Promise<UserState> {
  const [row] = await x
    .select({
      phoneVerified: user.phoneNumberVerified,
      kind: userRestrictions.kind,
      until: userRestrictions.until,
      reason: userRestrictions.reason,
    })
    .from(user)
    .leftJoin(userRestrictions, eq(userRestrictions.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)
  if (!row) throw fail(401, 'UNAUTHORIZED', '请先登录')
  const active = row.kind && (row.kind === 'ban' || !row.until || row.until > new Date())
  return {
    phoneVerified: row.phoneVerified === true,
    restriction: active ? { kind: row.kind!, until: row.until, reason: row.reason! } : null,
  }
}

export function assertNotBanned(state: UserState): void {
  if (state.restriction?.kind === 'ban') throw fail(403, 'BANNED', `账号已被封禁：${state.restriction.reason}`)
}

// 发言 = 发帖、回复、应答、评价、私聊、建圈、改昵称，以及经工具以本人名义发帖
export function assertCanSpeakState(state: UserState): void {
  assertNotBanned(state)
  if (state.restriction?.kind === 'mute') {
    throw fail(403, 'MUTED', `禁言中，到 ${state.restriction.until!.toISOString()}：${state.restriction.reason}`)
  }
  if (env.PHONE_REQUIRED && !state.phoneVerified) throw fail(403, 'PHONE_REQUIRED', PHONE_ERROR_CODES.PHONE_REQUIRED)
}

export async function assertCanSpeak(x: Executor, userId: string): Promise<void> {
  assertCanSpeakState(await userState(x, userId))
}

export async function assertActive(x: Executor, userId: string): Promise<void> {
  assertNotBanned(await userState(x, userId))
}
