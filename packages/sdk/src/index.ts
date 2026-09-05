import { TOOL_API_OPS } from '@harth/shared/tool-api'
import { createHarthApi, HarthError, type HarthCircle, type HarthToolInfo, type HarthUser } from './client'

export { HarthError } from './client'
export type { HarthCircle, HarthToolInfo, HarthUser, Member, PostSummary, StorageItem } from './client'

export interface HarthContext {
  user: HarthUser
  circle: HarthCircle
  tool: HarthToolInfo
  scopes: string[]
  apiUrl: string
  entryUrl: string
  origin: string
}

interface ContextMessage {
  harth: 'context'
  context: HarthContext
  token: string
  expiresAt: number
}

const CONNECT_TIMEOUT_MS = 10_000

class Harth {
  private context: HarthContext | null = null
  private token = ''
  private expiresAt = 0
  private hostOrigin: string | null
  private waiters: ((context: HarthContext) => void)[] = []
  private api = createHarthApi(async (op, args) => {
    const route = TOOL_API_OPS[op]
    const body = route.body?.(...args)
    const res = await this.send(route.path(...args), {
      method: route.method,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  })

  storage = this.api.storage
  members = this.api.members
  circleInfo = this.api.circleInfo
  posts = this.api.posts

  constructor() {
    this.hostOrigin = safeOrigin(document.referrer)
    window.addEventListener('message', this.onMessage)
    this.post({ harth: 'ready' })
  }

  get user(): HarthUser {
    return this.require().user
  }

  get circle(): HarthCircle {
    return this.require().circle
  }

  get scopes(): string[] {
    return this.require().scopes
  }

  connect(): Promise<HarthContext> {
    if (this.context) return Promise.resolve(this.context)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HarthError(0, '没有收到火塘的上下文，工具需要在圈子页里打开')), CONNECT_TIMEOUT_MS)
      this.waiters.push((context) => {
        clearTimeout(timer)
        resolve(context)
      })
    })
  }

  // 调用工具自己的后端动作（清单里 actions 声明、backend 文件实现）
  async call<T = unknown>(name: string, input?: unknown): Promise<T> {
    const res = await this.send(`/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ input: input ?? null }),
    })
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null
    if (!res.ok) throw new HarthError(res.status, body?.error ?? `请求失败（${res.status}）`)
    return body?.result as T
  }

  private require(): HarthContext {
    if (!this.context) throw new HarthError(0, '还没连接上火塘，先 await harth.connect()')
    return this.context
  }

  private post(message: unknown): void {
    if (window.parent === window) return
    window.parent.postMessage(message, this.hostOrigin ?? '*')
  }

  private onMessage = (event: MessageEvent): void => {
    if (event.source !== window.parent) return
    if (this.hostOrigin && event.origin !== this.hostOrigin) return
    const data = event.data as Partial<ContextMessage> | null
    if (!data || data.harth !== 'context' || !data.context || !data.token) return
    this.hostOrigin ??= event.origin
    this.context = data.context
    this.token = data.token
    this.expiresAt = data.expiresAt ?? 0
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter(data.context)
  }

  private refresh(): Promise<HarthContext> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HarthError(0, '刷新令牌超时')), CONNECT_TIMEOUT_MS)
      this.waiters.push((context) => {
        clearTimeout(timer)
        resolve(context)
      })
      this.post({ harth: 'refresh' })
    })
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const context = await this.connect()
    if (Date.now() / 1000 > this.expiresAt - 30) await this.refresh()
    const request = () =>
      fetch(`${context.apiUrl}/api/tool${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      })
    let res = await request()
    if (res.status === 401) {
      await this.refresh()
      res = await request()
    }
    return res
  }
}

function safeOrigin(url: string): string | null {
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
}

export const harth = new Harth()
export default harth
