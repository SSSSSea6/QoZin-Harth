import { createHmac, timingSafeEqual } from 'node:crypto'
import { sign, verify } from 'hono/jwt'
import type { ToolScope } from '@harth/shared'
import { env } from '../env'

export interface ToolTokenPayload {
  sub: string
  cid: string
  tid: string
  scopes: ToolScope[]
  dev?: boolean
  review?: boolean
  exp: number
  [key: string]: unknown
}

const TTL_SECONDS = 15 * 60
const PREVIEW_TTL_SECONDS = 60 * 60

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

function previewDigest(versionId: string, exp: number): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`preview:${versionId}:${exp}`)
    .digest('hex')
    .slice(0, 32)
}

// 试运行的静态路径签名：<exp>.<digest>，整包文件都在这个前缀下
export function signPreviewPath(versionId: string): string {
  const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS
  return `${exp}.${previewDigest(versionId, exp)}`
}

export function verifyPreviewPath(versionId: string, segment: string): boolean {
  const [expText, digest] = segment.split('.')
  const exp = Number(expText)
  if (!Number.isInteger(exp) || !digest || exp < Date.now() / 1000) return false
  const expected = previewDigest(versionId, exp)
  return digest.length === expected.length && timingSafeEqual(Buffer.from(digest), Buffer.from(expected))
}
