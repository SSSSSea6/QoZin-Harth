'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel } from '@/components/panel'
import { Badge } from '@/components/ui/badge'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'
import { VERSION_STATUS, type VersionStatus } from '@/lib/tool-status'

interface ReviewItem {
  id: string
  version: string
  status: VersionStatus
  review: {
    ai?: { verdict: string }
    error?: string
    decidedBy?: 'checks' | 'ai' | 'admin'
  } | null
  createdAt: string
  reviewedAt: string | null
  tool: { slug: string; name: string }
  developer: { id: string; name: string }
  description: string
}

const DECIDED_BY = { checks: '自动检查', ai: 'AI', admin: '管理员' } as const

export default function ReviewQueuePage() {
  const { session, pending } = useRequireSession()
  const [data, setData] = useState<{ pending: ReviewItem[]; recent: ReviewItem[] } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.tools.review.$get()
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setData((await res.json()) as { pending: ReviewItem[]; recent: ReviewItem[] })
  }, [session])

  useLoad(load)

  if (pending || !session) return null

  return (
    <Columns>
      <Panel padded={false}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-[15px] font-semibold">待审</h1>
          {data && <span className="text-xs text-muted-foreground">{data.pending.length} 个版本</span>}
        </div>
        {error && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{error}</p>}
        {data === null && !error && <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>}
        {data && data.pending.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">没有待审的工具。</p>
        )}
        <ul>
          {data?.pending.map((item) => (
            <ReviewRow key={item.id} item={item} />
          ))}
        </ul>
      </Panel>

      {data && (
        <Panel padded={false}>
          <div className="border-b px-4 py-3">
            <h2 className="text-[15px] font-semibold">已处理</h2>
          </div>
          {data.recent.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">还没有处理过的版本。</p>
          )}
          <ul>
            {data.recent.map((item) => (
              <ReviewRow key={item.id} item={item} />
            ))}
          </ul>
        </Panel>
      )}
    </Columns>
  )
}

function ReviewRow({ item }: { item: ReviewItem }) {
  const decided = item.status !== 'pending'
  const flag = decided
    ? ''
    : item.review?.error
      ? 'AI 没跑完'
      : item.review?.ai?.verdict === 'manual'
        ? 'AI 拿不准'
        : ''
  const by = item.review?.decidedBy ? DECIDED_BY[item.review.decidedBy] : ''
  return (
    <li className="border-b last:border-b-0">
      <Link href={`/tools/review/${item.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
        <Avatar seed={`tool:${item.tool.slug}`} size={40} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-medium">{item.tool.name}</span>
            <span className="font-mono text-xs text-muted-foreground">v{item.version}</span>
            {decided && (
              <Badge variant={VERSION_STATUS[item.status].variant} className="rounded-sm">
                {VERSION_STATUS[item.status].label}
              </Badge>
            )}
            {flag && <span className="text-xs text-amber-500">{flag}</span>}
          </div>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{item.description}</p>
          <span className="mt-1 block text-xs text-muted-foreground">
            {item.developer.name} · {item.tool.slug} · {timeAgo(item.createdAt)} 提交
            {decided && item.reviewedAt ? ` · ${by ? `${by} ` : ''}${timeAgo(item.reviewedAt)} 处理` : ''}
          </span>
        </div>
      </Link>
    </li>
  )
}
