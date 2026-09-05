'use client'

import { describeCron, TOOL_SCOPES, type ToolSchedule, type ToolScope } from '@harth/shared'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelTitle } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface ToolDetail {
  slug: string
  name: string
  description: string
  permissions: ToolScope[]
  schedules: ToolSchedule[]
  hasBackend: boolean
  version: string
  updatedAt: string | null
  isMine: boolean
}

interface OwnedCircle {
  id: string
  name: string
  installed: boolean
}

export default function ToolPage() {
  const { session, pending } = useRequireSession()
  const { slug } = useParams<{ slug: string }>()
  const [tool, setTool] = useState<ToolDetail | null>(null)
  const [circles, setCircles] = useState<OwnedCircle[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.tools[':slug'].$get({ param: { slug } })
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    const data = await res.json()
    setTool(data.tool as ToolDetail)
    setCircles(data.myCircles)
  }, [session, slug])

  useLoad(load)

  if (pending || !session) return null
  if (error) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
      </Panel>
    )
  }
  if (!tool) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </Panel>
    )
  }

  async function toggle(circle: OwnedCircle) {
    setBusy(circle.id)
    setError('')
    const res = circle.installed
      ? await api.circles[':id'].tools[':slug'].$delete({ param: { id: circle.id, slug } })
      : await api.circles[':id'].tools[':slug'].$post({ param: { id: circle.id, slug } })
    setBusy(null)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    void load()
  }

  return (
    <Columns
      aside={
        <Panel>
          <PanelTitle>安装到圈子</PanelTitle>
          <InstallList circles={circles} busy={busy} onToggle={toggle} />
        </Panel>
      }
    >
      <Panel>
        <div className="flex gap-4">
          <Avatar seed={`tool:${tool.slug}`} size={56} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{tool.name}</h1>
              <span className="text-xs text-muted-foreground">v{tool.version}</span>
            </div>
            <p className="mt-1 text-[15px] leading-7">{tool.description}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {tool.updatedAt ? `更新于 ${timeAgo(tool.updatedAt)}` : ''}
              {tool.isMine ? ' · 这是你发布的' : ''}
            </p>
          </div>
        </div>

        <div className="mt-5 border-t pt-4">
          <h2 className="text-sm font-medium">安装后它能</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {tool.permissions.map((scope) => (
              <li key={scope} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                {TOOL_SCOPES[scope]}
              </li>
            ))}
          </ul>
          {tool.schedules.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {tool.schedules.map((schedule) => (
                <li key={schedule.name} className="flex gap-2">
                  <span className="text-muted-foreground">·</span>
                  {describeCron(schedule.cron) ?? schedule.cron} 运行 {schedule.action}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            没有列出的它做不了；工具的数据按圈隔离，卸载即清空。
            {tool.hasBackend ? '它的后端代码在平台沙箱里运行，没有网络。' : ''}
          </p>
        </div>
      </Panel>

      <div className="xl:hidden">
        <Panel>
          <PanelTitle>安装到圈子</PanelTitle>
          <InstallList circles={circles} busy={busy} onToggle={toggle} />
        </Panel>
      </div>
    </Columns>
  )
}

function InstallList({
  circles,
  busy,
  onToggle,
}: {
  circles: OwnedCircle[]
  busy: string | null
  onToggle: (circle: OwnedCircle) => void
}) {
  if (circles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        只有圈主能安装工具。你还没有自己的圈子，
        <Link href="/circles/new" className="underline">
          点一堆火
        </Link>
        。
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-3">
      {circles.map((circle) => (
        <li key={circle.id} className="flex items-center gap-3">
          <Avatar seed={circle.id} size={28} />
          <span className="min-w-0 flex-1 truncate text-sm">{circle.name}</span>
          <Button
            size="sm"
            variant={circle.installed ? 'outline' : 'default'}
            disabled={busy === circle.id}
            onClick={() => onToggle(circle)}
          >
            {circle.installed ? '卸载' : '安装'}
          </Button>
        </li>
      ))}
    </ul>
  )
}
