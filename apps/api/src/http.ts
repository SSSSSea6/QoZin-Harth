import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// 带机器码的错误：响应体是 { error, code }，网页、App、工具桥都按 code 分流
export function fail(status: ContentfulStatusCode, code: string, message: string): HTTPException {
  return new HTTPException(status, { message, cause: { code } })
}

export function errorCode(err: HTTPException): string | undefined {
  const cause = err.cause as { code?: unknown } | undefined
  return typeof cause?.code === 'string' ? cause.code : undefined
}
