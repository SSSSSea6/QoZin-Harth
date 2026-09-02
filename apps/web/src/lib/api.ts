import { hc } from 'hono/client'
import type { AppType } from 'api/src/app'

// 生产镜像构建时置空，走同源反向代理
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const api = hc<AppType>(API_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' }),
}).api

export async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? '出错了，稍后再试'
  } catch {
    return '出错了，稍后再试'
  }
}
