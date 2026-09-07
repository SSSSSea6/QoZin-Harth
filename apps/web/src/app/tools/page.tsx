'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { ListSkeleton, Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface MarketTool {
  slug: string
  name: string
  description: string
  version: string
  updatedAt: string | null
}

export default function ToolsPage() {
  const { session, pending } = useRequireSession()
  const [tools, setTools] = useState<MarketTool[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.tools.$get()
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setTools((await res.json()).tools as MarketTool[])
  }, [session])

  useLoad(load)

  if (pending || !session) return null

  return (
    <Columns aside={<DevPanel />}>
      <Panel padded={false}>
        <PanelHeader
          title="工具"
          action={
            <Link href="/tools/mine" className="text-[13px] text-muted-foreground hover:text-foreground">
              我发布的
            </Link>
          }
        />
        {error && <p className="px-4 py-6 text-sm text-destructive md:px-5">{error}</p>}
        {tools === null && !error && <ListSkeleton rows={3} />}
        {tools && tools.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground md:px-5">还没有上架的工具。</p>
        )}
        <ul>
          {tools?.map((tool) => (
            <li key={tool.slug} className="border-b last:border-b-0">
              <Link
                href={`/tools/${tool.slug}`}
                className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-hover md:px-5"
              >
                <Avatar seed={`tool:${tool.slug}`} name={tool.name} size={48} shape="square" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold">{tool.name}</span>
                  <p className="mt-0.5 line-clamp-2 text-[15px] leading-6 text-foreground-2">{tool.description}</p>
                  <span className="mt-1.5 block text-[13px] text-muted-foreground">
                    v{tool.version}
                    {tool.updatedAt ? ` · 更新于 ${timeAgo(tool.updatedAt)}` : ''}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </Columns>
  )
}

function DevPanel() {
  return (
    <Panel>
      <PanelTitle>做一个工具</PanelTitle>
      <p className="text-sm leading-6 text-foreground-2">一个页面加几行代码，就能跑在任何圈子里。</p>
      <Link href="/developers" className="mt-2 block text-sm hover:underline">
        开发者说明与额度
      </Link>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          用命令行发布
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-6">
          {'npm i -g harth\nharth login\nharth init\nharth dev\nharth publish'}
        </pre>
      </details>
    </Panel>
  )
}
