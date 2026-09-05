// 工具能做的操作与工具 API 路由的对应；浏览器 SDK 与后端沙箱的桥都从这里取。
// 这个文件会被打进工具 SDK，不能引入 zod。

export interface ToolApiRoute {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE'
  path: (...args: unknown[]) => string
  body?: (...args: unknown[]) => unknown
  okStatuses?: number[]
}

function key(value: unknown): string {
  return encodeURIComponent(String(value))
}

export const TOOL_API_OPS: Record<
  'storage.list' | 'storage.get' | 'storage.set' | 'storage.delete' | 'circle.info' | 'members.list' | 'posts.list' | 'posts.create',
  ToolApiRoute
> = {
  'storage.list': {
    method: 'GET',
    path: (prefix) => (prefix ? `/storage?prefix=${key(prefix)}` : '/storage'),
  },
  'storage.get': { method: 'GET', path: (k) => `/storage/${key(k)}`, okStatuses: [404] },
  'storage.set': {
    method: 'PUT',
    path: (k) => `/storage/${key(k)}`,
    body: (_k, value, options) => ({
      value,
      expectedVersion: (options as { expectedVersion?: number } | undefined)?.expectedVersion,
    }),
  },
  'storage.delete': { method: 'DELETE', path: (k) => `/storage/${key(k)}` },
  'circle.info': { method: 'GET', path: () => '/circle' },
  'members.list': { method: 'GET', path: () => '/members' },
  'posts.list': { method: 'GET', path: () => '/posts' },
  'posts.create': { method: 'POST', path: () => '/posts', body: (input) => input },
}

export type ToolApiOp = keyof typeof TOOL_API_OPS
