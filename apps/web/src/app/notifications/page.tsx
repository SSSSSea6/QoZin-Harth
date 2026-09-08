'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Panel, PanelHeader } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface Notification {
  id: string
  kind: 'dm' | 'tool_post' | 'circle_dying' | 'application' | 'report' | 'moderation' | 'appeal'
  circleId: string | null
  refType: string
  refId: string
  title: string
  body: string
  count: number
  createdAt: string
  updatedAt: string
  readAt: string | null
}

// 目标地址由类型决定，不接受服务端以外的任意路径
function targetOf(n: Notification, meId: string): string {
  switch (n.kind) {
    case 'dm':
    case 'tool_post':
    case 'circle_dying':
      return `/c/${n.refId}`
    case 'application':
      return '/developers'
    default:
      return `/u/${meId}`
  }
}

export default function NotificationsPage() {
  const { session, pending } = useRequireSession()
  const [rows, setRows] = useState<Notification[] | null>(null)
  const [error, setError] = useState('')
  const [more, setMore] = useState(true)

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.notifications.$get({ query: {} })
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    const list = (await res.json()).notifications as Notification[]
    setRows(list)
    setMore(list.length === 30)
  }, [session])

  useLoad(load)

  async function loadMore() {
    if (!rows || rows.length === 0) return
    const res = await api.notifications.$get({ query: { before: rows[rows.length - 1]!.id } })
    if (!res.ok) return
    const list = (await res.json()).notifications as Notification[]
    setRows([...rows, ...list])
    setMore(list.length === 30)
  }

  async function open(n: Notification) {
    if (!n.readAt) {
      await api.notifications.read.$post({ json: { ids: [n.id], seenUpdatedAt: n.updatedAt } })
    }
  }

  if (pending || !session) return null

  const unread = rows?.filter((n) => !n.readAt).length ?? 0

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Panel padded={false}>
        <PanelHeader
          title="通知"
          description={unread > 0 ? `${unread} 条未读` : undefined}
          action={
            unread > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={async () => {
                  const latest = rows?.[0]?.updatedAt
                  await api.notifications.read.$post({ json: { all: true, seenUpdatedAt: latest } })
                  void load()
                }}
              >
                全部已读
              </Button>
            ) : undefined
          }
        />
        {error && <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-5">{error}</p>}
        {rows && rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground md:px-5">还没有通知。</p>}
        <ul>
          {rows?.map((n) => (
            <li key={n.id} className="border-b last:border-b-0">
              <Link
                href={targetOf(n, session.user.id)}
                onClick={() => void open(n)}
                className={`flex flex-col gap-0.5 px-4 py-3 hover:bg-hover md:px-5 ${n.readAt ? 'text-muted-foreground' : ''}`}
              >
                <span className="flex items-baseline gap-2">
                  <span className={`text-[15px] ${n.readAt ? '' : 'font-medium text-foreground'}`}>{n.title}</span>
                  {n.count > 1 && <span className="text-xs text-muted-foreground">{n.count} 条</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{timeAgo(n.updatedAt)}</span>
                </span>
                {n.body && <span className="truncate text-sm text-muted-foreground">{n.body}</span>}
              </Link>
            </li>
          ))}
        </ul>
        {rows && more && rows.length > 0 && (
          <div className="px-4 py-3 md:px-5">
            <Button variant="outline" size="sm" onClick={loadMore}>
              更早的
            </Button>
          </div>
        )}
      </Panel>
    </div>
  )
}
