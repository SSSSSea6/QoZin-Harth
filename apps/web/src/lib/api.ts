import { hc } from 'hono/client'
import type { AppType } from 'api/src/app'

// 生产镜像构建时置空，走同源反向代理
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const api = hc<AppType>(API_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' }),
}).api

export interface ApiError {
  error: string
  code?: string
}

export async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiError>
    return { error: body.error ?? '出错了，稍后再试', code: body.code }
  } catch {
    return { error: '出错了，稍后再试' }
  }
}

export async function errorText(res: Response): Promise<string> {
  return (await readError(res)).error
}
