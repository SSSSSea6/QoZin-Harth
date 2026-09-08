'use client'

import { ChevronLeft, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { ConsentPanel, type ConsentRequest } from '@/components/consent-panels'
import { ItemMenu } from '@/components/item-menu'
import { Panel } from '@/components/panel'
import { ToolFrame, type ToolGrant } from '@/components/tool-frame'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { useLoad, useRequireSession } from '@/lib/hooks'

export default function ToolHostPage() {
  const { session, pending } = useRequireSession()
  const { id, slug } = useParams<{ id: string; slug: string }>()
  const router = useRouter()
  const [grant, setGrant] = useState<ToolGrant | null>(null)
  const [consent, setConsent] = useState<ConsentRequest | null>(null)
  const [error, setError] = useState('')
  const [feedbackError, setFeedbackError] = useState('')

  const mint = useCallback(async () => {
    const res = await api.circles[':id'].tools[':slug'].token.$post({ param: { id, slug } })
    if (res.status === 428) {
      setConsent(((await res.json()) as { consent: ConsentRequest }).consent)
      return null
    }
    if (!res.ok) {
      setError(await errorText(res))
      return null
    }
    setConsent(null)
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

  // 自己的工具不给自己发消息；开发者已注销时接口不返回 developer
  const developer = grant?.developer && grant.developer.id !== session.user.id ? grant.developer : null

  async function feedback() {
    if (!developer) return
    setFeedbackError('')
    const res = await api.circles.dm.$post({ json: { userId: developer.id } })
    if (!res.ok) {
      setFeedbackError(await errorText(res))
      return
    }
    router.push(`/c/${(await res.json()).circle.id}`)
  }

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
        {developer && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void feedback()}>
            <MessageSquare aria-hidden /> 给 {developer.name} 反馈
          </Button>
        )}
        {grant?.toolId && slug !== '_dev' && <ItemMenu targetType="tool" targetId={grant.toolId} className={developer ? '' : 'ml-auto'} />}
      </div>
      {feedbackError && <p className="text-sm text-destructive">{feedbackError}</p>}

      {consent ? (
        <ConsentPanel circleId={id} request={consent} onConsented={() => void mint()} />
      ) : error ? (
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        </Panel>
      ) : (
        <Panel padded={false} className="overflow-hidden">
          {grant ? (
            <ToolFrame grant={grant} mint={mint} className="h-[calc(100vh-11rem)] min-h-[480px]" />
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground md:px-5">加载中…</p>
          )}
        </Panel>
      )}
    </div>
  )
}
