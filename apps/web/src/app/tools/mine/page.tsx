'use client'

import { formatFuel } from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Columns } from '@/components/columns'
import { FuelMeter } from '@/components/fuel-meter'
import { Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  installs: number
  week: { runs: number; ok: number; failed: number; skipped: number }
  monthUnits: number
}

interface Mine {
  tools: MyTool[]
  developer: 'none' | 'active' | 'revoked'
  usage: { month: string; used: number; reserved: number; allowance: number; storageBytes: number }
}

// 真实圈的运行只给次数，不给内容
function weekSummary(tool: MyTool): string {
  const parts = [`装在 ${tool.installs} 个圈里`]
  if (tool.week.runs > 0 || tool.week.skipped > 0) {
    let runs = `近 7 天后端运行 ${tool.week.runs} 次，成功 ${tool.week.ok}`
    if (tool.week.failed > 0) runs += `，失败 ${tool.week.failed}`
    if (tool.week.skipped > 0) runs += `，跳过 ${tool.week.skipped}`
    parts.push(runs)
  }
  if (tool.monthUnits > 0) parts.push(`本月燃料 ${formatFuel(tool.monthUnits)}`)
  return parts.join(' · ')
}

export default function MyToolsPage() {
  const { session, pending } = useRequireSession()
  const [mine, setMine] = useState<Mine | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.tools.mine.$get()
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setMine((await res.json()) as Mine)
  }, [session])

  useLoad(load)

  if (pending || !session) return null

  return (
    <Columns
      aside={
        <>
          {mine && (
            <Panel>
              <PanelTitle>本月燃料</PanelTitle>
              <FuelMeter usage={mine.usage} />
            </Panel>
          )}
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
            <Link href="/developers" className="mt-3 block text-sm hover:underline">
              开发者说明与额度
            </Link>
          </Panel>
        </>
      }
    >
      <Panel padded={false}>
        <PanelHeader
          title="我发布的工具"
          action={
            <Link href="/tools" className="text-[13px] text-muted-foreground hover:text-foreground">
              工具市场
            </Link>
          }
        />
        {error && <p className="px-4 py-6 text-sm text-destructive md:px-5">{error}</p>}
        {mine === null && !error && <p className="px-4 py-6 text-sm text-muted-foreground md:px-5">加载中…</p>}
        {mine && mine.developer !== 'active' && (
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm md:px-5">
            <span className="text-foreground-2">
              {mine.developer === 'revoked' ? '开发者资格已被撤销，不能再发布。' : '发布工具需要开发者资格。'}
            </span>
            {mine.developer === 'none' && (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/developers" />}>
                去申请或兑换邀请码
              </Button>
            )}
          </div>
        )}
        {mine && mine.tools.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground md:px-5">
            还没有发布过工具。在终端里 <code>harth init</code> 开始。
          </p>
        )}
        <ul>
          {mine?.tools.map((tool) => (
            <li key={tool.slug} className="border-b px-4 py-4 last:border-b-0 md:px-5">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{tool.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{tool.slug}</span>
                {tool.currentVersionId && (
                  <Link href={`/tools/${tool.slug}`} className="ml-auto text-[13px] text-muted-foreground hover:text-foreground">
                    市场页
                  </Link>
                )}
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">{weekSummary(tool)}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {tool.versions.map((v) => (
                  <li key={v.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px]">v{v.version}</span>
                      <Badge variant={VERSION_STATUS[v.status].variant}>{VERSION_STATUS[v.status].label}</Badge>
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
