'use client'

import { APPEAL_TEXT_MAX, REPORT_REASONS } from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Panel, PanelHeader } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

export const ACTION_LABEL: Record<string, string> = {
  hide: '隐藏内容',
  restore: '恢复内容',
  mute: '禁言',
  unmute: '解除禁言',
  ban: '封禁',
  unban: '解除封禁',
  tool_suspend: '停用工具',
  tool_restore: '恢复工具',
}

export const TARGET_LABEL: Record<string, string> = {
  post: '帖子',
  comment: '回复',
  response: '应答',
  review: '评价',
  message: '消息',
  user: '账号',
  tool: '工具',
  circle: '圈子',
}

interface MyModeration {
  id: string
  action: string
  targetType: string
  targetId: string
  reason: string
  until: string | null
  createdAt: string
  reversed: boolean
  appealStatus: string | null
  appealNote: string | null
}

// 针对我的处置，每条可以申诉一次
export function MyModerations({ title = '针对我的处置' }: { title?: string }) {
  const [rows, setRows] = useState<MyModeration[] | null>(null)
  const load = useCallback(async () => {
    const res = await api.appeals.mine.$get()
    if (res.ok) setRows((await res.json()).moderations as MyModeration[])
  }, [])
  useLoad(load)
  if (rows === null || rows.length === 0) return null
  return (
    <Panel padded={false}>
      <PanelHeader as="h2" title={title} />
      <ul>
        {rows.map((m) => (
          <li key={m.id} className="flex flex-col gap-1 border-b px-4 py-3 text-sm last:border-b-0 md:px-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{ACTION_LABEL[m.action] ?? m.action}</span>
              <span className="text-muted-foreground">{TARGET_LABEL[m.targetType]}</span>
              <span className="text-xs text-muted-foreground">{timeAgo(m.createdAt)}</span>
              {m.until && !m.reversed && <span className="text-xs text-muted-foreground">到 {new Date(m.until).toLocaleString('zh-CN')}</span>}
              {m.reversed && <span className="text-xs text-muted-foreground">已撤销</span>}
            </div>
            <p className="text-muted-foreground">原因：{m.reason}</p>
            {m.appealStatus === 'pending' && <p className="text-xs text-muted-foreground">申诉已提交，等待处理</p>}
            {m.appealStatus === 'rejected' && <p className="text-xs text-muted-foreground">申诉未通过{m.appealNote ? `：${m.appealNote}` : ''}</p>}
            {m.appealStatus === 'accepted' && <p className="text-xs text-muted-foreground">申诉通过</p>}
            {!m.appealStatus && !m.reversed && <AppealDialog moderationId={m.id} onDone={load} />}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function AppealDialog({ moderationId, onDone }: { moderationId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="w-fit">申诉</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>申诉</DialogTitle>
          <DialogDescription>每条处置只能申诉一次，说清楚为什么这个处置不合理。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`appeal-${moderationId}`}>说明</Label>
          <Textarea id={`appeal-${moderationId}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={APPEAL_TEXT_MAX} rows={4} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true)
              setError('')
              const res = await api.appeals.$post({ json: { moderationId, text: text.trim() } })
              setBusy(false)
              if (!res.ok) {
                setError(await errorText(res))
                return
              }
              setOpen(false)
              onDone()
            }}
          >
            {busy ? '提交中…' : '提交申诉'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface MyReport {
  id: string
  targetType: string
  targetId: string
  reason: string
  status: string
  createdAt: string
}

const REPORT_STATUS: Record<string, string> = { pending: '待处理', handled: '已处理', dismissed: '已驳回' }

export function MyReports() {
  const [rows, setRows] = useState<MyReport[] | null>(null)
  const load = useCallback(async () => {
    const res = await api.reports.mine.$get()
    if (res.ok) setRows((await res.json()).reports as MyReport[])
  }, [])
  useLoad(load)
  if (rows === null || rows.length === 0) return null
  return (
    <Panel padded={false}>
      <PanelHeader as="h2" title="我的举报" />
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2 border-b px-4 py-3 text-sm last:border-b-0 md:px-5">
            <span>{TARGET_LABEL[r.targetType]}</span>
            <span className="text-muted-foreground">{REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS] ?? r.reason}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {REPORT_STATUS[r.status]} · {timeAgo(r.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function MyBlocks() {
  const [rows, setRows] = useState<{ id: string; createdAt: string }[] | null>(null)
  const load = useCallback(async () => {
    const res = await api.users.me.blocks.$get()
    if (res.ok) setRows((await res.json()).blocks as { id: string; createdAt: string }[])
  }, [])
  useLoad(load)
  if (rows === null || rows.length === 0) return null
  return (
    <Panel padded={false}>
      <PanelHeader as="h2" title="屏蔽列表" description="对方的帖子和回复不会出现在你的列表里，双方不能私聊" />
      <ul>
        {rows.map((b) => (
          <li key={b.id} className="flex items-center gap-2 border-b px-4 py-2 text-sm last:border-b-0 md:px-5">
            <Link href={`/u/${b.id}`} className="hover:underline">
              用户 {b.id.slice(0, 6)}
            </Link>
            <span className="text-xs text-muted-foreground">{timeAgo(b.createdAt)}</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={async () => {
                const res = await api.users[':id'].block.$delete({ param: { id: b.id } })
                if (res.ok) void load()
              }}
            >
              取消屏蔽
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
