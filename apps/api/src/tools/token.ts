import { sign, verify } from 'hono/jwt'
import type { ToolScope } from '@harth/shared'
import { env } from '../env'

export interface ToolTokenPayload {
  sub: string
  cid: string
  tid: string
  scopes: ToolScope[]
  exp: number
  [key: string]: unknown
}

const TTL_SECONDS = 15 * 60

export async function issueToolToken(
  payload: Omit<ToolTokenPayload, 'exp'>,
): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS
  const token = await sign({ ...payload, exp }, env.BETTER_AUTH_SECRET)
  return { token, expiresAt: exp }
}

export async function verifyToolToken(token: string): Promise<ToolTokenPayload> {
  return (await verify(token, env.BETTER_AUTH_SECRET, 'HS256')) as ToolTokenPayload
}
