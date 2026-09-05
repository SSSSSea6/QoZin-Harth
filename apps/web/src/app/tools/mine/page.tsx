'use client'

import { TOOL_RUN_ERROR_CODES } from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Columns } from '@/components/columns'
import { Panel, PanelTitle } from '@/components/panel'
import { Badge } from '@/components/ui/badge'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'
import { VERSION_STATUS, type VersionStatus } from '@/lib/tool-status'

interface Review {
  checks?: { name: string; ok: boolean; detail?: string }[]
  ai?: { verdict: string; summary: string; issues: string[]; usefulness: number }
  admin?: { decision: string; note?: string }
  error?: string
}

interface Version {
  id: string
  version: string
  status: VersionStatus
  review: Review | null
  createdAt: string
}

interface MyTool {
  slug: string
  name: string
  currentVersionId: string | null
  versions: Version[]
  runs: { total: number; ok: number; failed: Record<string, number> }
}

// 真实圈的运行只给次数与错误码，不给内容
function runSummary(runs: MyTool['runs']): string {
  if (runs.total === 0) return ''
  const failed = Object.entries(runs.failed)
    .map(([code, n]) => `${TOOL_RUN_ERROR_CODES[code as keyof typeof TOOL_RUN_ERROR_CODES] ?? code} ${n}`)
    .join('、')
  return `最近 7 天后端运行 ${runs.total} 次，成功 ${runs.ok} 次${failed ? `，失败：${failed}` : ''}`
}

export default function MyToolsPage() {
  const { session, pending } = useRequireSession()
  const [tools, setTools] = useState<MyTool[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.tools.mine.$get()
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setTools((await res.json()).tools as MyTool[])
  }, [session])

  useLoad(load)

  if (pending || !session) return null

  return (
    <Columns
      aside={
        <Panel>
          <PanelTitle>发布流程</PanelTitle>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>
              <code>harth publish</code> 上传
            </li>
            <li>自动检查文件、外部资源、后端与时间表</li>
            <li>AI 审核代码与权限</li>
            <li>通过即上架，圈主可安装</li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            后端动作用 <code>harth run</code> 在开发圈里试跑，<code>harth logs</code> 看记录。
          </p>
        </Panel>
      }
    >
      <Panel padded={false}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-[15px] font-semibold">我发布的工具</h1>
          <Link href="/tools" className="text-xs text-muted-foreground hover:text-foreground">
            工具市场
          </Link>
        </div>
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {tools === null && !error && <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>}
        {tools && tools.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            还没有发布过工具。在终端里 <code>harth init</code> 开始。
          </p>
        )}
        <ul>
          {tools?.map((tool) => (
            <li key={tool.slug} className="border-b px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-medium">{tool.name}</span>
                <span className="text-xs text-muted-foreground">{tool.slug}</span>
                {tool.currentVersionId && (
                  <Link href={`/tools/${tool.slug}`} className="ml-auto text-xs hover:underline">
                    市场页
                  </Link>
                )}
              </div>
              {runSummary(tool.runs) && (
                <p className="mt-1 text-xs text-muted-foreground">{runSummary(tool.runs)}</p>
              )}
              <ul className="mt-2 flex flex-col gap-2">
                {tool.versions.map((v) => (
                  <li key={v.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px]">v{v.version}</span>
                      <Badge variant={VERSION_STATUS[v.status].variant} className="rounded-sm">
                        {VERSION_STATUS[v.status].label}
                      </Badge>
                      <span className="ml-auto text-xs text-muted-foreground">{timeAgo(v.createdAt)}</span>
                    </div>
                    <ReviewLines review={v.review} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>
    </Columns>
  )
}

function ReviewLines({ review }: { review: Review | null }) {
  if (!review) return null
  const failed = (review.checks ?? []).filter((c) => !c.ok)
  const lines: string[] = []
  for (const check of failed) lines.push(`${check.name}：${check.detail ?? '未通过'}`)
  if (review.ai) {
    lines.push(review.ai.summary)
    for (const issue of review.ai.issues) lines.push(issue)
  }
  if (review.admin?.note) lines.push(`管理员：${review.admin.note}`)
  if (review.error) lines.push(`审核暂时没跑完：${review.error}`)
  if (lines.length === 0) return null
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-muted-foreground">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  )
}
