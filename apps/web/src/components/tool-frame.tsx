'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ToolGrant {
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

// 工具 ready 时下发上下文与令牌；令牌快过期或工具要求 refresh 时重新签发
export function ToolFrame({
  grant,
  mint,
  className,
}: {
  grant: ToolGrant
  mint: () => Promise<ToolGrant | null>
  className?: string
}) {
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
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

  return (
    <iframe
      ref={frame}
      src={grant.context.entryUrl}
      title={grant.context.tool.name}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      referrerPolicy="strict-origin"
      className={cn('block w-full bg-background', className)}
    />
  )
}
