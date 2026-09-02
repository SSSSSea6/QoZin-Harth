export interface HarthUser {
  id: string
  name: string
}

export interface HarthCircle {
  id: string
  name: string
}

export interface HarthContext {
  user: HarthUser
  circle: HarthCircle
  tool: { slug: string; name: string; version: string }
  scopes: string[]
  apiUrl: string
  entryUrl: string
  origin: string
}

export interface StorageItem<T = unknown> {
  key: string
  value: T
  version: number
}

export interface Member {
  id: string
  name: string
  role: string
  joinedAt: string
}

export interface PostSummary {
  id: string
  title: string
  templateKey: string
  fields: Record<string, unknown>
  status: string
  createdAt: string
  authorId: string
  authorName: string
}

export class HarthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
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

  storage = {
    get: async <T = unknown>(key: string): Promise<StorageItem<T> | null> => {
      const res = await this.request(`/storage/${encodeURIComponent(key)}`, {}, [404])
      return res ? ((res as { item: StorageItem<T> }).item ?? null) : null
    },
    set: async <T = unknown>(key: string, value: T, options: { expectedVersion?: number } = {}): Promise<StorageItem<T>> => {
      const res = (await this.request(`/storage/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value, expectedVersion: options.expectedVersion }),
      })) as { item: StorageItem<T> }
      return res.item
    },
    delete: async (key: string): Promise<void> => {
      await this.request(`/storage/${encodeURIComponent(key)}`, { method: 'DELETE' })
    },
    list: async <T = unknown>(prefix?: string): Promise<StorageItem<T>[]> => {
      const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''
      const res = (await this.request(`/storage${query}`)) as { items: StorageItem<T>[] }
      return res.items
    },
  }

  members = async (): Promise<Member[]> => {
    const res = (await this.request('/members')) as { members: Member[] }
    return res.members
  }

  circleInfo = async (): Promise<HarthCircle & { memberCount: number }> => {
    const res = (await this.request('/circle')) as { circle: HarthCircle & { memberCount: number } }
    return res.circle
  }

  posts = {
    list: async (): Promise<PostSummary[]> => {
      const res = (await this.request('/posts')) as { posts: PostSummary[] }
      return res.posts
    },
    create: async (input: { title: string; body?: string }): Promise<{ id: string }> => {
      const res = (await this.request('/posts', { method: 'POST', body: JSON.stringify(input) })) as {
        post: { id: string }
      }
      return res.post
    },
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

  private async request(path: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<unknown> {
    const context = await this.connect()
    if (Date.now() / 1000 > this.expiresAt - 30) await this.refresh()
    const send = () =>
      fetch(`${context.apiUrl}/api/tool${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      })
    let res = await send()
    if (res.status === 401) {
      await this.refresh()
      res = await send()
    }
    if (okStatuses.includes(res.status)) return null
    if (!res.ok) {
      let message = `请求失败（${res.status}）`
      try {
        message = ((await res.json()) as { error?: string }).error ?? message
      } catch {
        // 保留默认文案
      }
      throw new HarthError(res.status, message)
    }
    return res.json()
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
