'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from '@/components/panel'
import { api, errorText } from '@/lib/api'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface Grant {
  token: string
  expiresAt: number
  context: {
    user: { id: string; name: string }
    circle: { id: string; name: string }
    tool: { slug: string; name: string; version: string }
    scopes: string[]
    apiUrl: string
    entryUrl: string
    origin: string
  }
}

export default function ToolHostPage() {
  const { session, pending } = useRequireSession()
  const { id, slug } = useParams<{ id: string; slug: string }>()
  const [grant, setGrant] = useState<Grant | null>(null)
  const [error, setError] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)

  const mint = useCallback(async () => {
    const res = await api.circles[':id'].tools[':slug'].token.$post({ param: { id, slug } })
    if (!res.ok) {
      setError(await errorText(res))
      return null
    }
    const next = (await res.json()) as Grant
    setGrant(next)
    return next
  }, [id, slug])

  const load = useCallback(async () => {
    if (!session) return
    await mint()
  }, [session, mint])

  useLoad(load)

  useEffect(() => {
    if (!grant) return
    const origin = grant.context.origin
    const handler = async (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target || event.origin !== origin) return
      const kind = (event.data as { harth?: string } | null)?.harth
      if (kind !== 'ready' && kind !== 'refresh') return
      const fresh = kind === 'refresh' || Date.now() / 1000 > grant.expiresAt - 60 ? await mint() : grant
      if (!fresh) return
      target.postMessage(
        { harth: 'context', context: fresh.context, token: fresh.token, expiresAt: fresh.expiresAt },
        origin,
      )
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [grant, mint])

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
            <iframe
              ref={frame}
              src={grant.context.entryUrl}
              title={grant.context.tool.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              referrerPolicy="strict-origin"
              className="block h-[calc(100vh-11rem)] min-h-[480px] w-full bg-background"
            />
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">加载中…</p>
          )}
        </Panel>
      )}
    </div>
  )
}
