'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelTitle } from '@/components/panel'
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
    <Columns
      aside={
        <Panel>
          <PanelTitle>做一个工具</PanelTitle>
          <p className="text-sm text-muted-foreground">
            一个页面加几行代码，就能跑在任何圈子里。
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-6">
            {'npm i -g harth\nharth login\nharth init\nharth dev\nharth publish'}
          </pre>
          <Link href="/tools/mine" className="mt-3 block text-sm hover:underline">
            我发布的工具
          </Link>
        </Panel>
      }
    >
      <Panel padded={false}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-[15px] font-semibold">工具</h1>
          <Link href="/tools/mine" className="text-xs text-muted-foreground hover:text-foreground xl:hidden">
            我发布的
          </Link>
        </div>
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {tools === null && !error && <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>}
        {tools && tools.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">还没有上架的工具。</p>
        )}
        <ul>
          {tools?.map((tool) => (
            <li key={tool.slug} className="border-b last:border-b-0">
              <Link href={`/tools/${tool.slug}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
                <Avatar seed={`tool:${tool.slug}`} size={40} className="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{tool.name}</span>
                    <span className="text-xs text-muted-foreground">v{tool.version}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
                  {tool.updatedAt && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      更新于 {timeAgo(tool.updatedAt)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </Columns>
  )
}
