'use client'

import { describeCron, TOOL_SCOPES, type ToolScope } from '@harth/shared'
import { Copy, Flame, SquarePen } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelTitle } from '@/components/panel'
import { PostList, type PostListItemData } from '@/components/post-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { daysUntil, timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface CircleDetail {
  id: string
  name: string
  isDm: boolean
  peerId: string | null
  isOfficial: boolean
  visibility: string
  depth: number | null
  memberCount: number
  lifecycle: { state: string; deadline?: string }
  dormancyDays: number | null
  myRole: string | null
  inviteCode: string | null
  templates: string[]
}

const LAYER_NAMES: Record<number, string> = {
  1: '身份圈',
  2: '社群圈',
  3: '行动圈',
}

export default function CircleRoute() {
  return (
    <Suspense>
      <CirclePage />
    </Suspense>
  )
}

function CirclePage() {
  const { session, pending } = useRequireSession()
  const { id } = useParams<{ id: string }>()
  const inviteCode = useSearchParams().get('inviteCode') ?? undefined
  const [circle, setCircle] = useState<CircleDetail | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.circles[':id'].$get({
      param: { id },
      query: inviteCode ? { inviteCode } : {},
    })
    if (!res.ok) {
      setError(
        res.status === 404 ? '圈子不存在，或你还看不到它' : await errorText(res),
      )
      return
    }
    setCircle((await res.json()).circle as CircleDetail)
  }, [session, id, inviteCode])

  useLoad(load)

  if (pending || !session) return null
  if (error) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
      </Panel>
    )
  }
  if (!circle) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </Panel>
    )
  }

  if (circle.isDm) {
    return <DmPage circle={circle} onChanged={load} />
  }

  const isMember = circle.myRole !== null
  const archived = circle.lifecycle.state === 'archived'
  const hibernating = circle.lifecycle.state === 'hibernating'
  const canPost = isMember && !archived
  const showSecondhand =
    circle.templates.includes('secondhand') || circle.myRole === 'owner'

  async function renew() {
    await api.circles[':id'].renew.$post({ param: { id } })
    void load()
  }

  return (
    <Tabs defaultValue="posts" className="gap-4">
      <Columns
        aside={
          isMember ? <CircleAside circle={circle} onChanged={load} /> : undefined
        }
      >
        <Panel padded={false}>
          <div className="flex gap-4 px-4 py-4">
            <Avatar seed={circle.id} size={56} className="rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold">{circle.name}</h1>
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
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {circle.memberCount} 成员
                {circle.depth ? ` · ${LAYER_NAMES[circle.depth]}` : ''}
                {circle.dormancyDays === null
                  ? ' · 长明'
                  : ` · 沉寂 ${circle.dormancyDays} 天后开始倒计时`}
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {!isMember ? (
                <JoinButton circle={circle} inviteCode={inviteCode} onJoined={load} />
              ) : (
                <>
                  {hibernating && (
                    <Button onClick={renew}>
                      <Flame aria-hidden /> 添柴
                    </Button>
                  )}
                  {canPost && (
                    <Button
                      variant={hibernating ? 'outline' : 'default'}
                      nativeButton={false}
                      render={<Link href={`/posts/new?circle=${circle.id}`} />}
                    >
                      <SquarePen aria-hidden /> 发帖
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {hibernating && (
            <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
              好久没动静了，{daysUntil(circle.lifecycle.deadline!)}将安静熄灭。任何成员添一把柴就能续上。
            </div>
          )}
          {archived && (
            <div className="border-t bg-muted px-4 py-2 text-sm text-muted-foreground">
              这堆火已经熄了。内容保留，只读。
            </div>
          )}

          {isMember && (
            <TabsList
              variant="line"
              className="h-11 w-full justify-start gap-5 border-t px-4"
            >
              <TabsTrigger value="posts" className="flex-none px-0.5 text-[15px]">
                帖子
              </TabsTrigger>
              {showSecondhand && (
                <TabsTrigger
                  value="secondhand"
                  className="flex-none px-0.5 text-[15px]"
                >
                  二手
                </TabsTrigger>
              )}
              {(circle.depth ?? 3) < 3 && (
                <TabsTrigger
                  value="children"
                  className="flex-none px-0.5 text-[15px]"
                >
                  子圈
                </TabsTrigger>
              )}
              <TabsTrigger value="tools" className="flex-none px-0.5 text-[15px]">
                工具
              </TabsTrigger>
              <TabsTrigger value="members" className="flex-none px-0.5 text-[15px]">
                成员
              </TabsTrigger>
            </TabsList>
          )}
        </Panel>

        {!isMember ? (
          <Panel>
            <p className="py-8 text-center text-sm text-muted-foreground">
              加入后可以看到圈内的帖子，一起用这堆火。
            </p>
          </Panel>
        ) : (
          <>
            <TabsContent value="posts">
              <Panel padded={false}>
                <CirclePosts circleId={circle.id} />
              </Panel>
            </TabsContent>
            {showSecondhand && (
              <TabsContent value="secondhand">
                <SecondhandTab circle={circle} onChanged={load} />
              </TabsContent>
            )}
            <TabsContent value="children">
              <Panel padded={false}>
                <ChildrenTab circleId={circle.id} />
              </Panel>
            </TabsContent>
            <TabsContent value="tools">
              <Panel padded={false}>
                <ToolsTab circle={circle} />
              </Panel>
            </TabsContent>
            <TabsContent value="members">
              <Panel padded={false}>
                <MemberList circleId={circle.id} myId={session.user.id} />
              </Panel>
            </TabsContent>
          </>
        )}
      </Columns>
    </Tabs>
  )
}

function JoinButton({
  circle,
  inviteCode,
  onJoined,
}: {
  circle: CircleDetail
  inviteCode?: string
  onJoined: () => void
}) {
  const [error, setError] = useState('')
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={async () => {
          const res = await api.circles[':id'].join.$post({
            param: { id: circle.id },
            json: inviteCode ? { inviteCode } : {},
          })
          if (!res.ok) {
            setError(await errorText(res))
            return
          }
          onJoined()
        }}
      >
        加入圈子
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function CircleAside({
  circle,
  onChanged,
}: {
  circle: CircleDetail
  onChanged: () => void
}) {
  const isOwner = circle.myRole === 'owner'
  const secondhandOn = circle.templates.includes('secondhand')
  const archived = circle.lifecycle.state === 'archived'

  async function setSecondhand(enabled: boolean) {
    await api.circles[':id'].templates[':key'].$put({
      param: { id: circle.id, key: 'secondhand' },
      json: { enabled },
    })
    onChanged()
  }

  return (
    <>
      <Panel>
        <PanelTitle>关于这堆火</PanelTitle>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">状态</dt>
            <dd>
              {circle.lifecycle.state === 'active' && '燃着'}
              {circle.lifecycle.state === 'hibernating' &&
                `${daysUntil(circle.lifecycle.deadline!)}熄灭`}
              {archived && '已熄灭'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">成员</dt>
            <dd>{circle.memberCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">规则</dt>
            <dd className="text-right">
              {circle.dormancyDays === null
                ? '官方圈，长明'
                : `沉寂 ${circle.dormancyDays} 天进入倒计时`}
            </dd>
          </div>
        </dl>
        {isOwner && circle.inviteCode && !archived && (
          <div className="mt-3 border-t pt-3">
            <InviteDialog circleId={circle.id} code={circle.inviteCode} />
          </div>
        )}
      </Panel>

      {isOwner && !archived && (
        <Panel>
          <PanelTitle>圈内能力</PanelTitle>
          <div className="flex items-center justify-between text-sm">
            <div>
              <div className="font-medium">二手</div>
              <div className="text-xs text-muted-foreground">
                成员可以送出和收下闲置
              </div>
            </div>
            <Button
              size="sm"
              variant={secondhandOn ? 'outline' : 'default'}
              onClick={() => setSecondhand(!secondhandOn)}
            >
              {secondhandOn ? '停用' : '启用'}
            </Button>
          </div>
        </Panel>
      )}
    </>
  )
}

function InviteDialog({ circleId, code }: { circleId: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const link =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/c/${circleId}?inviteCode=${code}`
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="w-full">
            邀请成员
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请加入</DialogTitle>
          <DialogDescription>
            把链接发给要请的人，打开即可加入。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={link} className="text-xs" />
          <Button
            variant="outline"
            size="icon"
            aria-label="复制邀请链接"
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopied(true)
            }}
          >
            <Copy aria-hidden />
          </Button>
        </div>
        {copied && <p className="text-xs text-muted-foreground">已复制</p>}
      </DialogContent>
    </Dialog>
  )
}

function CirclePosts({ circleId }: { circleId: string }) {
  const [posts, setPosts] = useState<PostListItemData[] | null>(null)

  useEffect(() => {
    void api.posts.circles[':circleId']
      .$get({ param: { circleId }, query: {} })
      .then(async (res) => {
        if (res.ok) setPosts((await res.json()).posts as PostListItemData[])
      })
  }, [circleId])

  if (posts === null) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
  }
  return (
    <PostList
      posts={posts}
      showCircle={false}
      emptyText="还很安静。发第一帖，让火旺起来。"
    />
  )
}

function SecondhandTab({
  circle,
  onChanged,
}: {
  circle: CircleDetail
  onChanged: () => void
}) {
  const enabled = circle.templates.includes('secondhand')
  const [posts, setPosts] = useState<PostListItemData[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    void api.posts.circles[':circleId']
      .$get({ param: { circleId: circle.id }, query: { templateKey: 'secondhand' } })
      .then(async (res) => {
        if (res.ok) setPosts((await res.json()).posts as PostListItemData[])
      })
  }, [enabled, circle.id])

  if (!enabled) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            本圈还没启用二手能力。启用后，成员可以在这里送出和收下闲置。
          </p>
          <Button
            size="sm"
            onClick={async () => {
              await api.circles[':id'].templates[':key'].$put({
                param: { id: circle.id, key: 'secondhand' },
                json: { enabled: true },
              })
              onChanged()
            }}
          >
            启用二手
          </Button>
        </div>
      </Panel>
    )
  }

  return (
    <Panel padded={false}>
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-[13px] text-muted-foreground">
          {posts?.length ?? 0} 条闲置
        </span>
        {circle.lifecycle.state !== 'archived' && (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/posts/new?circle=${circle.id}&template=secondhand`} />}
          >
            发布闲置
          </Button>
        )}
      </div>
      {posts === null ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
      ) : (
        <PostList
          posts={posts}
          showCircle={false}
          emptyText="还没有闲置。你的旧书，可能正是别人要找的。"
        />
      )}
    </Panel>
  )
}

interface ChildCircle {
  id: string
  name: string
  lastActivityAt: string
  joined: boolean
  lifecycle: { state: string }
}

function ChildrenTab({ circleId }: { circleId: string }) {
  const [children, setChildren] = useState<ChildCircle[] | null>(null)

  useEffect(() => {
    void api.circles[':id'].children
      .$get({ param: { id: circleId } })
      .then(async (res) => {
        if (res.ok) setChildren((await res.json()).circles as ChildCircle[])
      })
  }, [circleId])

  if (children === null) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
  }
  if (children.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        这个圈子下面还没有小圈。去点第一堆火？
      </p>
    )
  }
  return (
    <ul>
      {children.map((child) => (
        <li key={child.id} className="border-b last:border-b-0">
          <Link
            href={`/c/${child.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
          >
            <Avatar seed={child.id} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[15px] font-medium">
                  {child.name}
                </span>
                {child.joined && (
                  <Badge variant="outline" className="rounded-sm">
                    已加入
                  </Badge>
                )}
                {child.lifecycle.state === 'hibernating' && (
                  <Badge className="rounded-sm border-transparent bg-amber-500/15 text-amber-300">
                    快熄了
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                最近活跃 {timeAgo(child.lastActivityAt)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

interface Member {
  id: string
  name: string
  role: string
  joinedAt: string
}

interface ToolScheduleView {
  name: string
  cron: string
  action: string
}

interface InstalledTool {
  slug: string
  name: string
  description: string
  installedBy: string
  installedAt: string
  hasBackend: boolean
  schedules: ToolScheduleView[]
  needsConfirm: boolean
  pending: { scopes: ToolScope[]; schedules: ToolScheduleView[] }
}

interface ToolRunView {
  id: string
  trigger: 'call' | 'schedule' | 'manual'
  action: string
  status: string
  errorCode: string | null
  error: string | null
  logs: string | null
  durationMs: number | null
  createdAt: string
}

const TRIGGER_LABEL = { call: '前端调用', schedule: '定时', manual: '手动' } as const
const RUN_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  ok: '成功',
  error: '失败',
  timeout: '超时',
  skipped: '跳过',
  interrupted: '中断',
}

function scheduleText(schedule: ToolScheduleView): string {
  return `${describeCron(schedule.cron) ?? schedule.cron} 运行 ${schedule.action}`
}

function ToolsTab({ circle }: { circle: CircleDetail }) {
  const [tools, setTools] = useState<InstalledTool[] | null>(null)
  const [dev, setDev] = useState<{ slug: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const [runsOf, setRunsOf] = useState<string | null>(null)
  const isOwner = circle.myRole === 'owner'

  const load = useCallback(async () => {
    const res = await api.circles[':id'].tools.$get({ param: { id: circle.id } })
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    const data = await res.json()
    setTools(data.tools as InstalledTool[])
    setDev(data.dev)
  }, [circle.id])

  useLoad(load)

  async function uninstall(tool: InstalledTool) {
    if (!window.confirm(`卸载「${tool.name}」？它在这个圈里保存的数据会一起清空。`)) return
    const res = await api.circles[':id'].tools[':slug'].$delete({
      param: { id: circle.id, slug: tool.slug },
    })
    if (!res.ok) setError(await errorText(res))
    else void load()
  }

  async function confirm(tool: InstalledTool) {
    const res = await api.circles[':id'].tools[':slug'].confirm.$post({
      param: { id: circle.id, slug: tool.slug },
    })
    if (!res.ok) setError(await errorText(res))
    else void load()
  }

  if (tools === null && !error) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
  }

  return (
    <>
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      {dev && (
        <Link
          href={`/c/${circle.id}/t/${dev.slug}`}
          className="flex items-center gap-3 border-b bg-amber-500/10 px-4 py-3 hover:bg-amber-500/15"
        >
          <Avatar seed={`tool:${dev.slug}`} size={36} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{dev.name}</span>
            <span className="text-xs text-muted-foreground">本地开发中，只有你能看到</span>
          </div>
        </Link>
      )}
      {tools && tools.length === 0 && !dev && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
          <p>这个圈还没装工具。</p>
          {isOwner && (
            <Link href="/tools" className="text-foreground underline">
              去工具市场看看
            </Link>
          )}
        </div>
      )}
      <ul>
        {tools?.map((tool) => (
          <li key={tool.slug} className="border-b last:border-b-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <Link href={`/c/${circle.id}/t/${tool.slug}`}>
                <Avatar seed={`tool:${tool.slug}`} size={36} className="rounded-lg" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/c/${circle.id}/t/${tool.slug}`}
                  className="block truncate text-[15px] font-medium hover:underline"
                >
                  {tool.name}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {tool.description} · {tool.installedBy} 安装
                </span>
                {tool.schedules.length > 0 && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    定时：{tool.schedules.map(scheduleText).join('；')}
                  </span>
                )}
              </div>
              {isOwner && tool.hasBackend && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setRunsOf(runsOf === tool.slug ? null : tool.slug)}
                >
                  运行记录
                </Button>
              )}
              {isOwner && circle.lifecycle.state !== 'archived' && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => uninstall(tool)}>
                  卸载
                </Button>
              )}
            </div>
            {isOwner && tool.needsConfirm && (
              <div className="flex flex-wrap items-center gap-3 border-t bg-amber-500/10 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  新版本改了权限或时间表：
                  {tool.pending.scopes.map((scope) => TOOL_SCOPES[scope]).join('、')}
                  {tool.pending.schedules.length > 0 && `；定时 ${tool.pending.schedules.map(scheduleText).join('；')}`}
                  。确认前按原来的执行。
                </span>
                <Button size="sm" onClick={() => confirm(tool)}>
                  确认
                </Button>
              </div>
            )}
            {runsOf === tool.slug && <ToolRuns circleId={circle.id} slug={tool.slug} />}
          </li>
        ))}
      </ul>
      {tools && tools.length > 0 && isOwner && (
        <div className="border-t px-4 py-2.5">
          <Link href="/tools" className="text-xs text-muted-foreground hover:text-foreground">
            去工具市场找更多
          </Link>
        </div>
      )}
    </>
  )
}

function ToolRuns({ circleId, slug }: { circleId: string; slug: string }) {
  const [runs, setRuns] = useState<ToolRunView[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await api.circles[':id'].tools[':slug'].runs.$get({ param: { id: circleId, slug } })
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setRuns((await res.json()).runs as ToolRunView[])
  }, [circleId, slug])

  useLoad(load)

  if (error) return <p className="border-t px-4 py-3 text-sm text-destructive">{error}</p>
  if (runs === null) return <p className="border-t px-4 py-3 text-sm text-muted-foreground">加载中…</p>
  if (runs.length === 0) return <p className="border-t px-4 py-3 text-sm text-muted-foreground">还没有运行过。</p>
  return (
    <ul className="border-t">
      {runs.map((run) => (
        <li key={run.id} className="border-b px-4 py-2 text-sm last:border-b-0">
          <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
            <span className={run.status === 'ok' ? '' : run.status === 'queued' || run.status === 'running' ? 'text-muted-foreground' : 'text-destructive'}>
              {RUN_STATUS_LABEL[run.status] ?? run.status}
            </span>
            <span className="font-mono">{run.action}</span>
            <span className="text-muted-foreground">{TRIGGER_LABEL[run.trigger]}</span>
            <span className="text-muted-foreground">{timeAgo(run.createdAt)}</span>
            {run.durationMs !== null && <span className="text-muted-foreground">{run.durationMs} ms</span>}
          </div>
          {run.error && <p className="mt-0.5 text-[13px] text-destructive">{run.error}</p>}
          {run.logs && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">日志</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded-md border px-3 py-2 text-xs leading-5">{run.logs}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}

function MemberList({ circleId, myId }: { circleId: string; myId: string }) {
  const router = useRouter()
  const [members, setMembers] = useState<Member[] | null>(null)

  useEffect(() => {
    void api.circles[':id'].members
      .$get({ param: { id: circleId } })
      .then(async (res) => {
        if (res.ok) setMembers((await res.json()).members as Member[])
      })
  }, [circleId])

  if (members === null) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
  }

  return (
    <ul>
      {members.map((member) => (
        <li
          key={member.id}
          className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
        >
          <Link href={`/u/${member.id}`}>
            <Avatar seed={member.id} size={36} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/u/${member.id}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {member.name}
              </Link>
              {member.role === 'owner' && (
                <Badge variant="outline" className="rounded-sm">
                  圈主
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {timeAgo(member.joinedAt)}加入
            </span>
          </div>
          {member.id !== myId && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await api.circles.dm.$post({
                  json: { userId: member.id },
                })
                if (res.ok) {
                  const { circle } = await res.json()
                  router.push(`/c/${circle.id}`)
                }
              }}
            >
              私聊
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

interface Message {
  id: string
  content: string
  createdAt: string
  authorId: string
  authorName: string
}

function DmPage({
  circle,
  onChanged,
}: {
  circle: CircleDetail
  onChanged: () => void
}) {
  const archived = circle.lifecycle.state === 'archived'
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await api.circles[':id'].messages.$get({
      param: { id: circle.id },
      query: {},
    })
    if (res.ok) setMessages((await res.json()).messages.reverse())
  }, [circle.id])

  useLoad(load)

  async function send() {
    const content = draft.trim()
    if (!content) return
    const res = await api.circles[':id'].messages.$post({
      param: { id: circle.id },
      json: { content },
    })
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setDraft('')
    setError('')
    void load()
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Panel padded={false}>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          {circle.peerId && <Avatar seed={circle.peerId} size={36} />}
          <div className="min-w-0 flex-1">
            <Link
              href={circle.peerId ? `/u/${circle.peerId}` : '#'}
              className="text-[15px] font-medium hover:underline"
            >
              {circle.name}
            </Link>
            <div className="text-xs text-muted-foreground">
              私聊 · {circle.dormancyDays} 天没动静会自动散场
            </div>
          </div>
          {circle.lifecycle.state === 'hibernating' && (
            <Button
              size="sm"
              onClick={async () => {
                await api.circles[':id'].renew.$post({ param: { id: circle.id } })
                onChanged()
              }}
            >
              <Flame aria-hidden /> 添柴
            </Button>
          )}
        </div>

        <div className="flex min-h-[320px] flex-col gap-4 px-4 py-4">
          {messages === null ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              打个招呼吧。
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {messages.map((m) => (
                <li key={m.id} className="flex gap-3">
                  <Avatar seed={m.authorId} size={32} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{m.authorName}</span>
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(m.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                      {m.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {archived ? (
          <div className="border-t bg-muted px-4 py-2 text-sm text-muted-foreground">
            这段对话已经安静散场，只读。
          </div>
        ) : (
          <div className="flex flex-col gap-2 border-t px-4 py-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="说点什么…（Ctrl+Enter 发送）"
              rows={2}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button size="sm" onClick={send} disabled={!draft.trim()}>
                发送
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
