'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { Panel } from '@/components/panel'
import { ToolFrame, type ToolGrant } from '@/components/tool-frame'
import { api, errorText } from '@/lib/api'
import { useLoad, useRequireSession } from '@/lib/hooks'

export default function ToolHostPage() {
  const { session, pending } = useRequireSession()
  const { id, slug } = useParams<{ id: string; slug: string }>()
  const [grant, setGrant] = useState<ToolGrant | null>(null)
  const [error, setError] = useState('')

  const mint = useCallback(async () => {
    const res = await api.circles[':id'].tools[':slug'].token.$post({ param: { id, slug } })
    if (!res.ok) {
      setError(await errorText(res))
      return null
    }
    const next = (await res.json()) as ToolGrant
    setGrant(next)
    return next
  }, [id, slug])

  const load = useCallback(async () => {
    if (!session) return
    await mint()
  }, [session, mint])

  useLoad(load)

  if (pending || !session) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Link href={`/c/${id}`} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {grant?.context.circle.name ?? '返回圈子'}
        </Link>
        {grant && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{grant.context.tool.name}</span>
            <span className="text-xs text-muted-foreground">
              {slug === '_dev' ? '本地开发中' : `v${grant.context.tool.version}`}
            </span>
          </>
        )}
      </div>

      {error ? (
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        </Panel>
      ) : (
        <Panel padded={false} className="overflow-hidden">
          {grant ? (
            <ToolFrame grant={grant} mint={mint} className="h-[calc(100vh-11rem)] min-h-[480px]" />
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
          )}
        </Panel>
      )}
    </div>
  )
}
