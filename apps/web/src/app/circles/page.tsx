'use client'

import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { ListSkeleton, Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface MyCircle {
  id: string
  name: string
  isDm: boolean
  isOfficial: boolean
  visibility: string
  role: string
  lastActivityAt: string
  lifecycle: { state: string }
}

interface TopCircle {
  id: string
  name: string
  joined: boolean
}

export default function CirclesPage() {
  const { session, pending } = useRequireSession()
  const [mine, setMine] = useState<MyCircle[] | null>(null)
  const [top, setTop] = useState<TopCircle[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const [mineRes, topRes] = await Promise.all([
      api.circles.mine.$get(),
      api.circles.top.$get(),
    ])
    if (!mineRes.ok) {
      setError(await errorText(mineRes))
      return
    }
    setMine((await mineRes.json()).circles as MyCircle[])
    if (topRes.ok) setTop((await topRes.json()).circles)
  }, [session])

  useLoad(load)

  if (pending || !session) return null

  const groups = mine?.filter((c) => !c.isDm) ?? []
  const dms = mine?.filter((c) => c.isDm) ?? []
  const unjoinedTop = top.filter((c) => !c.joined)

  return (
    <Columns
      aside={
        <Panel>
          <PanelTitle>点一堆新火</PanelTitle>
          <p className="mb-3 text-sm text-muted-foreground">
            为社团、宿舍、一次比赛或一趟拼车建个圈。没人添柴它会自己熄灭，不用收拾。
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/circles/new" />}
            className="w-full"
          >
            <Plus aria-hidden /> 建圈
          </Button>
        </Panel>
      }
    >
      <Panel padded={false}>
        <PanelHeader
          title="我的圈子"
          action={
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/circles/new" />}
              className="xl:hidden"
            >
              <Plus aria-hidden /> 建圈
            </Button>
          }
        />
        {error && <p className="px-5 py-6 text-sm text-destructive">{error}</p>}
        {mine === null && !error && <ListSkeleton rows={3} />}
        {mine && groups.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            还没有圈子。先加入学校圈，或者自己点一堆火。
          </p>
        )}
        <ul>
          {groups.map((circle) => (
            <li key={circle.id} className="border-b last:border-b-0">
              <Link
                href={`/c/${circle.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-hover"
              >
                <Avatar seed={circle.id} name={circle.name} size={44} shape="square" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">
                      {circle.name}
                    </span>
                    {circle.isOfficial && (
                      <Badge variant="secondary" className="rounded-sm">
                        官方
                      </Badge>
                    )}
                    {circle.visibility === 'private' && (
                      <Badge variant="outline" className="rounded-sm">
                        邀请制
                      </Badge>
                    )}
                    {circle.role === 'owner' && (
                      <Badge variant="outline" className="rounded-sm">
                        圈主
                      </Badge>
                    )}
                    {circle.lifecycle.state === 'hibernating' && (
                      <Badge className="rounded-sm border-transparent bg-amber-500/15 text-amber-300">
                        快熄了
                      </Badge>
                    )}
                    {circle.lifecycle.state === 'archived' && (
                      <Badge variant="outline" className="rounded-sm text-muted-foreground">
                        已归档
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    最近活跃 {timeAgo(circle.lastActivityAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      {dms.length > 0 && (
        <Panel padded={false}>
          <PanelHeader as="h2" title="私聊" />
          <ul>
            {dms.map((circle) => (
              <li key={circle.id} className="border-b last:border-b-0">
                <Link
                  href={`/c/${circle.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-hover"
                >
                  <Avatar seed={circle.id} name={circle.name} size={36} shape="square" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {circle.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(circle.lastActivityAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {unjoinedTop.length > 0 && (
        <Panel padded={false}>
          <PanelHeader as="h2" title="身份圈" />
          <ul>
            {unjoinedTop.map((circle) => (
              <li
                key={circle.id}
                className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
              >
                <Avatar seed={circle.id} name={circle.name} size={36} shape="square" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {circle.name}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const res = await api.circles[':id'].join.$post({
                      param: { id: circle.id },
                      json: {},
                    })
                    if (res.ok) void load()
                  }}
                >
                  加入
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Columns>
  )
}
