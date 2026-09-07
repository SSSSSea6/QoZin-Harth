'use client'

import { Flame } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { AuthForms } from '@/components/auth-forms'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { PostList, PostListSkeleton, type PostListItemData } from '@/components/post-list'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { daysUntil, timeAgo } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

export default function Home() {
  const { data: session, isPending } = useSession()
  if (isPending) return null
  return session ? <Feed /> : <Landing />
}

function Landing() {
  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col gap-6 pt-8 md:pt-16">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={96} height={96} className="size-16 rounded-2xl md:size-20" />
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wordmark.svg" alt="火塘" className="h-8 w-auto md:h-10" />
        </h1>
        <p className="text-[15px] text-foreground-2">
          拼车、二手、组队，从身边的圈子开始。
        </p>
      </div>
      <Panel className="md:p-6">
        <AuthForms />
      </Panel>
      <p className="text-center text-[13px] text-muted-foreground">
        想把工具放进圈子里？看{' '}
        <Link href="/developers" className="underline underline-offset-2 hover:text-foreground">
          开发者说明
        </Link>
        。
      </p>
    </div>
  )
}

interface MyCircle {
  id: string
  name: string
  isDm: boolean
  lastActivityAt: string
  lifecycle: { state: string; deadline?: string }
}

interface TopCircle {
  id: string
  name: string
  joined: boolean
}

interface NearbyCircle {
  id: string
  name: string
  lastActivityAt: string
  joined: boolean
}

interface MarketTool {
  slug: string
  name: string
  description: string
}

function Feed() {
  const [posts, setPosts] = useState<PostListItemData[] | null>(null)
  const [mine, setMine] = useState<MyCircle[]>([])
  const [top, setTop] = useState<TopCircle[]>([])
  const [nearby, setNearby] = useState<NearbyCircle[]>([])
  const [tools, setTools] = useState<MarketTool[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [feedRes, mineRes, topRes, toolsRes] = await Promise.all([
      api.posts.feed.$get({ query: {} }),
      api.circles.mine.$get(),
      api.circles.top.$get(),
      api.tools.$get(),
    ])
    if (!feedRes.ok) {
      setError(await errorText(feedRes))
      return
    }
    setPosts((await feedRes.json()).posts as PostListItemData[])
    if (mineRes.ok) setMine((await mineRes.json()).circles as MyCircle[])
    if (toolsRes.ok) setTools((await toolsRes.json()).tools.slice(0, 3))
    if (topRes.ok) {
      const topList = (await topRes.json()).circles
      setTop(topList)
      const lists = await Promise.all(
        topList
          .filter((c) => c.joined)
          .map((c) => api.circles[':id'].children.$get({ param: { id: c.id } })),
      )
      const found: NearbyCircle[] = []
      for (const res of lists) {
        if (res.ok) found.push(...((await res.json()).circles as NearbyCircle[]))
      }
      setNearby(found.filter((c) => !c.joined).slice(0, 5))
    }
  }, [])

  useLoad(load)

  const unjoinedTop = top.filter((c) => !c.joined)
  const dying = mine.filter((c) => c.lifecycle.state === 'hibernating')
  const hasCircles = mine.some((c) => !c.isDm && c.lifecycle.state !== 'archived')

  return (
    <Columns
      aside={
        <>
          {unjoinedTop.length > 0 && <JoinTopCard circles={unjoinedTop} onJoined={load} />}
          {dying.length > 0 && <DyingCard circles={dying} onRenewed={load} />}
          {nearby.length > 0 && <NearbyCard circles={nearby} onJoined={load} />}
          {tools.length > 0 && <ToolsCard tools={tools} />}
        </>
      }
    >
      <Panel padded={false}>
        <PanelHeader title="首页" />
        {error && <p className="px-4 py-6 text-sm text-destructive md:px-5">{error}</p>}
        {posts === null && !error && <PostListSkeleton />}
        {posts && (
          <PostList
            posts={posts}
            emptyText={hasCircles ? '圈子里还没有帖子。' : '还没有加入圈子。'}
            emptyAction={
              hasCircles ? (
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/posts/new" />}>
                  发第一帖
                </Button>
              ) : (
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/circles" />}>
                  去找圈子
                </Button>
              )
            }
          />
        )}
      </Panel>
    </Columns>
  )
}

function JoinTopCard({ circles, onJoined }: { circles: TopCircle[]; onJoined: () => void }) {
  return (
    <Panel>
      <PanelTitle>身份圈</PanelTitle>
      <ul className="flex flex-col gap-3">
        {circles.slice(0, 3).map((circle) => (
          <li key={circle.id} className="flex items-center gap-3">
            <Avatar seed={circle.id} name={circle.name} size={36} shape="square" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{circle.name}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await api.circles[':id'].join.$post({ param: { id: circle.id }, json: {} })
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

function DyingCard({ circles, onRenewed }: { circles: MyCircle[]; onRenewed: () => void }) {
  return (
    <Panel>
      <PanelTitle>快熄的火</PanelTitle>
      <ul className="flex flex-col gap-3">
        {circles.map((circle) => (
          <li key={circle.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/c/${circle.id}`} className="block truncate text-sm font-medium hover:underline">
                {circle.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {circle.lifecycle.deadline ? `${daysUntil(circle.lifecycle.deadline)}熄灭` : '沉寂中'}
              </span>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                await api.circles[':id'].renew.$post({ param: { id: circle.id } })
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

function NearbyCard({ circles, onJoined }: { circles: NearbyCircle[]; onJoined: () => void }) {
  return (
    <Panel>
      <PanelTitle>身份圈里的圈子</PanelTitle>
      <ul className="flex flex-col gap-3">
        {circles.map((circle) => (
          <li key={circle.id} className="flex items-center gap-3">
            <Avatar seed={circle.id} name={circle.name} size={32} shape="square" />
            <span className="min-w-0 flex-1">
              <Link href={`/c/${circle.id}`} className="block truncate text-sm font-medium hover:underline">
                {circle.name}
              </Link>
              <span className="block text-xs text-muted-foreground">最近活跃 {timeAgo(circle.lastActivityAt)}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await api.circles[':id'].join.$post({ param: { id: circle.id }, json: {} })
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

function ToolsCard({ tools }: { tools: MarketTool[] }) {
  return (
    <Panel>
      <PanelTitle
        action={
          <Link href="/tools" className="text-xs text-muted-foreground hover:text-foreground">
            市场
          </Link>
        }
      >
        新上架的工具
      </PanelTitle>
      <ul className="flex flex-col gap-2.5">
        {tools.map((tool) => (
          <li key={tool.slug}>
            <Link href={`/tools/${tool.slug}`} className="group flex items-center gap-3">
              <Avatar seed={`tool:${tool.slug}`} name={tool.name} size={32} shape="square" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:underline">{tool.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{tool.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
