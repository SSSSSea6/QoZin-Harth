import { TOOL_API_OPS, type ToolApiOp } from '@harth/shared/tool-api'

export interface HarthUser {
  id: string
  name: string
}

export interface HarthCircle {
  id: string
  name: string
}

export interface HarthToolInfo {
  slug: string
  name: string
  version: string
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
  authorId: string | null
  authorName: string | null
}

export class HarthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HarthError'
  }
}

export type HarthTransport = (op: ToolApiOp, args: unknown[]) => Promise<{ status: number; body: unknown }>

export function createHarthApi(transport: HarthTransport) {
  async function request(op: ToolApiOp, args: unknown[]): Promise<unknown> {
    const route = TOOL_API_OPS[op]
    const { status, body } = await transport(op, args)
    if (route.okStatuses?.includes(status)) return null
    if (status < 200 || status >= 300) {
      const message = (body as { error?: string } | null)?.error ?? `请求失败（${status}）`
      throw new HarthError(status, message)
    }
    return body
  }

  return {
    storage: {
      get: async <T = unknown>(key: string): Promise<StorageItem<T> | null> => {
        const res = (await request('storage.get', [key])) as { item: StorageItem<T> } | null
        return res?.item ?? null
      },
      set: async <T = unknown>(
        key: string,
        value: T,
        options: { expectedVersion?: number } = {},
      ): Promise<StorageItem<T>> => {
        const res = (await request('storage.set', [key, value, options])) as { item: StorageItem<T> }
        return res.item
      },
      delete: async (key: string): Promise<void> => {
        await request('storage.delete', [key])
      },
      list: async <T = unknown>(prefix?: string): Promise<StorageItem<T>[]> => {
        const res = (await request('storage.list', [prefix])) as { items: StorageItem<T>[] }
        return res.items
      },
    },
    members: async (): Promise<Member[]> => {
      const res = (await request('members.list', [])) as { members: Member[] }
      return res.members
    },
    circleInfo: async (): Promise<HarthCircle & { memberCount: number }> => {
      const res = (await request('circle.info', [])) as { circle: HarthCircle & { memberCount: number } }
      return res.circle
    },
    posts: {
      list: async (): Promise<PostSummary[]> => {
        const res = (await request('posts.list', [])) as { posts: PostSummary[] }
        return res.posts
      },
      create: async (input: { title: string; body?: string }): Promise<{ id: string }> => {
        const res = (await request('posts.create', [input])) as { post: { id: string } }
        return res.post
      },
    },
  }
}

export type HarthApi = ReturnType<typeof createHarthApi>
