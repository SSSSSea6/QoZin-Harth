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
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.tools[':slug'].$get({ param: { slug } })
    if (!res.ok) {
      setLoadError(await errorText(res))
      return
    }
    const data = await res.json()
    setTool(data.tool as ToolDetail)
    setCircles(data.myCircles)
  }, [session, slug])

  useLoad(load)

  if (pending || !session) return null
  if (loadError) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted-foreground">{loadError}</p>
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
    setActionError('')
    const res = circle.installed
      ? await api.circles[':id'].tools[':slug'].$delete({ param: { id: circle.id, slug } })
      : await api.circles[':id'].tools[':slug'].$post({ param: { id: circle.id, slug } })
    setBusy(null)
    if (!res.ok) {
      setActionError(await errorText(res))
      return
    }
    void load()
  }

  const meta = [
    `v${tool.version}`,
    tool.updatedAt ? `更新于 ${timeAgo(tool.updatedAt)}` : '',
    tool.isMine ? '这是你发布的' : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Columns
      aside={
        <Panel>
          <PanelTitle>安装到圈子</PanelTitle>
          <InstallList circles={circles} slug={slug} busy={busy} error={actionError} onToggle={toggle} />
        </Panel>
      }
    >
      <Panel className="md:p-6">
        <div className="flex gap-4">
          <Avatar seed={`tool:${tool.slug}`} name={tool.name} size={56} shape="square" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold leading-tight md:text-2xl">{tool.name}</h1>
            <p className="mt-1.5 text-[15px] leading-6 text-foreground-2">{tool.description}</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{meta}</p>
          </div>
        </div>

        <div className="mt-6 border-t pt-5">
          <h2 className="text-sm font-semibold">安装后它能</h2>
          <ul className="mt-2 flex flex-col gap-2 text-[15px] leading-6">
            {tool.permissions.map((scope) => (
              <li key={scope} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                {TOOL_SCOPES[scope]}
              </li>
            ))}
          </ul>
          {tool.hasBackend && (
            <p className="mt-2 text-[13px] text-muted-foreground">它的后端代码在平台沙箱里运行，没有网络。</p>
          )}
        </div>

        {tool.schedules.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold">定时运行</h2>
            <ul className="mt-2 flex flex-col gap-2 text-[15px] leading-6">
              {tool.schedules.map((schedule) => (
                <li key={schedule.name} className="flex gap-2">
                  <span className="text-muted-foreground">·</span>
                  {describeCron(schedule.cron) ?? schedule.cron} 运行 {schedule.action}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </Columns>
  )
}

function InstallList({
  circles,
  slug,
  busy,
  error,
  onToggle,
}: {
  circles: OwnedCircle[]
  slug: string
  busy: string | null
  error: string
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
    <div>
      <ul className="flex flex-col">
        {circles.map((circle) => (
          <li key={circle.id} className="flex min-h-14 items-center gap-3 border-b py-2 last:border-b-0">
            <Avatar seed={circle.id} name={circle.name} size={32} shape="square" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{circle.name}</span>
              {circle.installed && <span className="block text-xs text-muted-foreground">已安装</span>}
            </div>
            {circle.installed ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/c/${circle.id}/t/${slug}`} />}
                >
                  打开
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={busy === circle.id}
                  onClick={() => onToggle(circle)}
                >
                  {busy === circle.id ? '卸载中…' : '卸载'}
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy === circle.id} onClick={() => onToggle(circle)}>
                {busy === circle.id ? '安装中…' : '安装'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      <p className="mt-3 text-[13px] leading-5 text-foreground-2">
        没有列出的它做不了；工具的数据按圈隔离，卸载就清空那个圈里的数据。
      </p>
    </div>
  )
}
