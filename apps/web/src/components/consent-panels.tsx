'use client'

import { TOOL_SCOPES, type ToolScope } from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Panel, PanelHeader } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

export interface ConsentRequest {
  tool: { id: string; slug: string; name: string; version: string }
  developer: { id: string; name: string } | null
  scopes: ToolScope[]
}

// 第一次在圈里打开工具：先看它要拿什么，同意了才发令牌
export function ConsentPanel({
  circleId,
  request,
  onConsented,
}: {
  circleId: string
  request: ConsentRequest
  onConsented: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Panel className="mx-auto w-full max-w-xl">
      <div className="flex items-center gap-3">
        <Avatar seed={`tool:${request.tool.slug}`} name={request.tool.name} size={48} shape="square" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{request.tool.name}</h2>
          <p className="text-sm text-muted-foreground">
            v{request.tool.version}
            {request.developer && (
              <>
                {' · '}
                <Link href={`/u/${request.developer.id}`} className="hover:underline">
                  {request.developer.name}
                </Link>
                {' 开发'}
              </>
            )}
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm">这个工具在这个圈里会用到你的：</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {request.scopes.map((scope) => (
          <li key={scope} className="flex gap-2">
            <span className="text-muted-foreground">·</span>
            {TOOL_SCOPES[scope]}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted-foreground">工具拿不到你的登录状态；同意后可以在个人页随时撤回，撤回后它立刻读不到你的数据。</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            const res = await api.circles[':id'].tools[':slug'].consent.$post({ param: { id: circleId, slug: request.tool.slug } })
            setBusy(false)
            if (!res.ok) {
              setError(await errorText(res))
              return
            }
            onConsented()
          }}
        >
          {busy ? '请稍等…' : '同意并打开'}
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href={`/c/${circleId}`} />}>
          不打开
        </Button>
      </div>
    </Panel>
  )
}

interface ConsentRow {
  toolId: string
  circleId: string
  scopes: string[]
  consentedAt: string
  toolSlug: string
  toolName: string
  circleName: string
}

export function MyConsents() {
  const [rows, setRows] = useState<ConsentRow[] | null>(null)
  const load = useCallback(async () => {
    const res = await api.users.me.consents.$get()
    if (res.ok) setRows((await res.json()).consents as ConsentRow[])
  }, [])
  useLoad(load)
  if (rows === null || rows.length === 0) return null
  return (
    <Panel padded={false}>
      <PanelHeader as="h2" title="工具授权" description="撤回后工具立刻读不到你的数据，再打开时会重新问" />
      <ul>
        {rows.map((r) => (
          <li key={`${r.toolId}:${r.circleId}`} className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0 md:px-5">
            <div className="min-w-0 flex-1">
              <Link href={`/c/${r.circleId}/t/${r.toolSlug}`} className="font-medium hover:underline">
                {r.toolName}
              </Link>
              <span className="text-muted-foreground"> · {r.circleName}</span>
              <p className="truncate text-xs text-muted-foreground">
                {r.scopes.map((s) => TOOL_SCOPES[s as ToolScope] ?? s).join('、')} · {timeAgo(r.consentedAt)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={async () => {
                const res = await api.users.me.consents[':toolId'][':circleId'].$delete({ param: { toolId: r.toolId, circleId: r.circleId } })
                if (res.ok) void load()
              }}
            >
              撤回
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
