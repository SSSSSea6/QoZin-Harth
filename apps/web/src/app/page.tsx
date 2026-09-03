'use client'

import { Flame } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { AuthForms } from '@/components/auth-forms'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelTitle } from '@/components/panel'
import { PostList, type PostListItemData } from '@/components/post-list'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { daysUntil } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

export default function Home() {
  const { data: session, isPending } = useSession()
  if (isPending) return null
  return session ? <Feed /> : <Landing />
}

function Landing() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={64} height={64} className="size-16 rounded-2xl" />
        <h1 className="text-2xl font-semibold">火塘</h1>
        <p className="text-sm text-muted-foreground">
          拼车、二手、组队，从身边的圈子开始。
        </p>
      </div>
      <Panel>
        <AuthForms />
      </Panel>
    </div>
  )
}

interface MyCircle {
  id: string
  name: string
  isDm: boolean
  lifecycle: { state: string; deadline?: string }
}

interface TopCircle {
  id: string
  name: string
  joined: boolean
}

function Feed() {
  const [posts, setPosts] = useState<PostListItemData[] | null>(null)
  const [mine, setMine] = useState<MyCircle[]>([])
  const [top, setTop] = useState<TopCircle[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [feedRes, mineRes, topRes] = await Promise.all([
      api.posts.feed.$get({ query: {} }),
      api.circles.mine.$get(),
      api.circles.top.$get(),
    ])
    if (!feedRes.ok) {
      setError(await errorText(feedRes))
      return
    }
    setPosts((await feedRes.json()).posts as PostListItemData[])
    if (mineRes.ok) setMine((await mineRes.json()).circles as MyCircle[])
    if (topRes.ok) setTop((await topRes.json()).circles)
  }, [])

  useLoad(load)

  const unjoinedTop = top.filter((c) => !c.joined)
  const dying = mine.filter((c) => c.lifecycle.state === 'hibernating')
  const hasCircles = mine.some((c) => !c.isDm)

  return (
    <Columns
      aside={
        unjoinedTop.length > 0 || dying.length > 0 ? (
          <>
            {unjoinedTop.length > 0 && (
              <JoinTopCard circles={unjoinedTop} onJoined={load} />
            )}
            {dying.length > 0 && <DyingCard circles={dying} onRenewed={load} />}
          </>
        ) : undefined
      }
    >
      <Panel padded={false}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-[15px] font-semibold">首页</h1>
          <span className="text-xs text-muted-foreground">
            你所在圈子的最新帖子
          </span>
        </div>
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {posts === null && !error && (
          <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
        )}
        {posts && (
          <PostList
            posts={posts}
            emptyText={
              hasCircles
                ? '你的圈子里还没有帖子。去发第一帖，让火旺起来。'
                : '先加入一个圈子，这里就会有内容了。'
            }
          />
        )}
      </Panel>
      {!hasCircles && unjoinedTop.length > 0 && (
        <div className="xl:hidden">
          <JoinTopCard circles={unjoinedTop} onJoined={load} />
        </div>
      )}
    </Columns>
  )
}

function JoinTopCard({
  circles,
  onJoined,
}: {
  circles: TopCircle[]
  onJoined: () => void
}) {
  return (
    <Panel>
      <PanelTitle>身份圈</PanelTitle>
      <ul className="flex flex-col gap-3">
        {circles.map((circle) => (
          <li key={circle.id} className="flex items-center gap-3">
            <Avatar seed={circle.id} size={32} />
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
                if (res.ok) onJoined()
              }}
            >
              加入
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function DyingCard({
  circles,
  onRenewed,
}: {
  circles: MyCircle[]
  onRenewed: () => void
}) {
  return (
    <Panel>
      <PanelTitle>快熄的火</PanelTitle>
      <ul className="flex flex-col gap-3">
        {circles.map((circle) => (
          <li key={circle.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Link
                href={`/c/${circle.id}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {circle.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {circle.lifecycle.deadline
                  ? `${daysUntil(circle.lifecycle.deadline)}熄灭`
                  : '沉寂中'}
              </span>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                await api.circles[':id'].renew.$post({
                  param: { id: circle.id },
                })
                onRenewed()
              }}
            >
              <Flame aria-hidden /> 添柴
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
