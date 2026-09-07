'use client'

import { INVITES_PER_DEVELOPER } from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { InviteList, type InviteView } from '@/components/invite-list'
import { Panel, PanelHeader } from '@/components/panel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

interface Application {
  id: string
  userId: string
  userName: string
  message: string
  status: 'pending' | 'approved' | 'rejected'
  note: string | null
  createdAt: string
  decidedAt: string | null
}

interface Developer {
  userId: string
  name: string
  source: 'invite' | 'application' | 'admin'
  grantedAt: string
  revokedAt: string | null
  revokeReason: string | null
}

const SOURCE = { invite: '邀请码', application: '申请', admin: '管理员' } as const

// 审核页里管理员管开发者：申请、邀请码、已有资格
export function DeveloperAdmin() {
  const [applications, setApplications] = useState<Application[] | null>(null)
  const [invites, setInvites] = useState<{ unused: InviteView[]; used: InviteView[] } | null>(null)
  const [developers, setDevelopers] = useState<Developer[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [appsRes, invitesRes, devsRes] = await Promise.all([
      api.developers.applications.$get({ query: { status: 'pending' } }),
      api.developers.invites.$get(),
      api.developers.list.$get(),
    ])
    if (!appsRes.ok) {
      setError(await errorText(appsRes))
      return
    }
    setApplications((await appsRes.json()).applications as Application[])
    if (invitesRes.ok) setInvites((await invitesRes.json()) as { unused: InviteView[]; used: InviteView[] })
    if (devsRes.ok) setDevelopers((await devsRes.json()).developers as Developer[])
  }, [])

  useLoad(load)

  async function decide(id: string, decision: 'approve' | 'reject', note?: string) {
    setBusy(true)
    setError('')
    const res = await api.developers.applications[':id'].decide.$post({ param: { id }, json: { decision, note } })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return false
    }
    void load()
    return true
  }

  async function issue() {
    setBusy(true)
    setError('')
    const res = await api.developers.invites.$post({ json: { count: INVITES_PER_DEVELOPER } })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    void load()
  }

  async function revoke(userId: string, reason: string) {
    setBusy(true)
    setError('')
    const res = await api.developers[':userId'].revoke.$post({ param: { userId }, json: { reason } })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return false
    }
    void load()
    return true
  }

  async function restore(userId: string) {
    setBusy(true)
    setError('')
    const res = await api.developers[':userId'].restore.$post({ param: { userId } })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    void load()
  }

  return (
    <>
      <Panel padded={false}>
        <PanelHeader as="h2" title="开发者申请" description={applications ? `${applications.length} 条待处理` : undefined} />
        {error && <p className="px-4 py-3 text-sm text-destructive md:px-5">{error}</p>}
        {applications && applications.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-5">没有待处理的申请。</p>
        )}
        <ul>
          {applications?.map((application) => (
            <li key={application.id} className="flex gap-3 border-b px-4 py-4 last:border-b-0 md:px-5">
              <Link href={`/u/${application.userId}`} className="mt-0.5 shrink-0">
                <Avatar seed={application.userId} name={application.userName} size={36} />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted-foreground">
                  <Link href={`/u/${application.userId}`} className="text-sm font-semibold text-foreground hover:underline">
                    {application.userName}
                  </Link>
                  <time dateTime={application.createdAt}>{timeAgo(application.createdAt)}</time>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">{application.message}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void decide(application.id, 'approve')}>
                    通过
                  </Button>
                  <ReasonDialog
                    title="驳回申请"
                    description={`告诉 ${application.userName} 为什么没通过，对方在开发者页能看到。`}
                    trigger="驳回"
                    confirm="驳回"
                    busy={busy}
                    onConfirm={(note) => decide(application.id, 'reject', note)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel padded={false}>
        <PanelHeader
          as="h2"
          title="邀请码"
          action={
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void issue()}>
              生成 {INVITES_PER_DEVELOPER} 个
            </Button>
          }
        />
        <div className="px-4 py-3 md:px-5">
          {invites ? <InviteList invites={[...invites.unused, ...invites.used]} /> : <p className="text-sm text-muted-foreground">加载中…</p>}
        </div>
      </Panel>

      <Panel padded={false}>
        <PanelHeader as="h2" title="开发者" description={developers ? `${developers.length} 人` : undefined} />
        {developers && developers.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-5">还没有开发者。</p>
        )}
        <ul>
          {developers?.map((developer) => (
            <li key={developer.userId} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 md:px-5">
              <Avatar seed={developer.userId} name={developer.name} size={32} />
              <div className="min-w-0 flex-1">
                <Link href={`/u/${developer.userId}`} className="text-sm font-semibold hover:underline">
                  {developer.name}
                </Link>
                <p className="text-[13px] text-muted-foreground">
                  {SOURCE[developer.source]} · {timeAgo(developer.grantedAt)}
                  {developer.revokedAt ? ` · 已撤销${developer.revokeReason ? `：${developer.revokeReason}` : ''}` : ''}
                </p>
              </div>
              {developer.revokedAt ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(developer.userId)}>
                  恢复
                </Button>
              ) : (
                <ReasonDialog
                  title="撤销开发者资格"
                  description="撤销后不能再发布，未用的邀请码作废；已装进圈子的工具照常运行。"
                  trigger="撤销"
                  confirm="撤销"
                  busy={busy}
                  onConfirm={(reason) => revoke(developer.userId, reason)}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  )
}

function ReasonDialog({
  title,
  description,
  trigger,
  confirm,
  busy,
  onConfirm,
}: {
  title: string
  description: string
  trigger: string
  confirm: string
  busy: boolean
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost" className="text-muted-foreground">
            {trigger}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`reason-${title}`}>原因</Label>
          <Textarea id={`reason-${title}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              if (await onConfirm(reason.trim())) {
                setReason('')
                setOpen(false)
              }
            }}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
