'use client'

import { MODERATION_REASON_MAX, REPORT_REASONS } from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { ACTION_LABEL, TARGET_LABEL } from '@/components/moderation-panels'
import { Panel, PanelHeader } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

interface ReportItem {
  id: string
  targetType: string
  targetId: string
  reason: string
  detail: string | null
  snapshot: string | null
  createdAt: string
  reporterName: string | null
}

interface AppealItem {
  id: string
  moderationId: string
  text: string
  createdAt: string
  userId: string
  userName: string
  action: string
  targetType: string
  reason: string
}

interface ModerationItem {
  id: string
  action: string
  targetType: string
  targetId: string
  subjectUserId: string | null
  reason: string
  until: string | null
  reversalOf: string | null
  createdAt: string
  byName: string
}

interface RuleItem {
  id: string
  pattern: string
  kind: 'reject' | 'flag'
  note: string | null
}

interface RecentContent {
  posts: { id: string; circleId: string; title: string; authorId: string | null; authorName: string | null; createdAt: string; hiddenAt: string | null }[]
  comments: { id: string; postId: string; content: string; authorId: string; authorName: string; createdAt: string; hiddenAt: string | null }[]
}

type Action = 'hide' | 'mute' | 'ban' | 'tool_suspend' | 'dismiss'

function targetHref(type: string, id: string): string | null {
  if (type === 'post') return `/p/${id}`
  if (type === 'user') return `/u/${id}`
  if (type === 'circle') return `/c/${id}`
  return null
}

export function GovernanceAdmin() {
  const [reports, setReports] = useState<ReportItem[] | null>(null)
  const [appeals, setAppeals] = useState<AppealItem[] | null>(null)
  const [moderations, setModerations] = useState<ModerationItem[] | null>(null)
  const [rules, setRules] = useState<RuleItem[] | null>(null)
  const [content, setContent] = useState<RecentContent | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [r, a, m, ru, co] = await Promise.all([
      api.admin.reports.$get({ query: {} }),
      api.admin.appeals.$get({ query: {} }),
      api.admin.moderations.$get(),
      api.admin.rules.$get(),
      api.admin.content.$get(),
    ])
    if (!r.ok) {
      setError(await errorText(r))
      return
    }
    setReports((await r.json()).reports as ReportItem[])
    if (a.ok) setAppeals((await a.json()).appeals as AppealItem[])
    if (m.ok) setModerations((await m.json()).moderations as ModerationItem[])
    if (ru.ok) setRules((await ru.json()).rules as RuleItem[])
    if (co.ok) setContent((await co.json()) as RecentContent)
  }, [])

  useLoad(load)

  async function decide(id: string, action: Action, reason: string, days?: 1 | 7 | 30): Promise<boolean> {
    const res = await api.admin.reports[':id'].decide.$post({ param: { id }, json: { action, reason, days } })
    if (!res.ok) {
      setError(await errorText(res))
      return false
    }
    void load()
    return true
  }

  async function moderate(targetType: 'post' | 'comment', targetId: string, reason: string): Promise<boolean> {
    const res = await api.admin.moderate.$post({ json: { targetType, targetId, action: 'hide', reason } })
    if (!res.ok) {
      setError(await errorText(res))
      return false
    }
    void load()
    return true
  }

  return (
    <>
      <Panel padded={false}>
        <PanelHeader as="h2" title="举报" description={reports ? `${reports.length} 条待处理` : undefined} />
        {error && <p className="px-4 py-3 text-sm text-destructive md:px-5">{error}</p>}
        {reports && reports.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-5">没有待处理的举报。</p>}
        <ul>
          {reports?.map((r) => {
            const href = targetHref(r.targetType, r.targetId)
            return (
              <li key={r.id} className="flex flex-col gap-1 border-b px-4 py-3 text-sm last:border-b-0 md:px-5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{TARGET_LABEL[r.targetType]}</span>
                  <span className="text-muted-foreground">{REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS] ?? (r.reason === 'rule' ? '规则命中' : r.reason)}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.reporterName ?? '系统'} · {timeAgo(r.createdAt)}
                  </span>
                </div>
                {r.snapshot && (
                  <p className="truncate text-muted-foreground">
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {r.snapshot}
                      </Link>
                    ) : (
                      r.snapshot
                    )}
                  </p>
                )}
                {r.detail && <p className="text-muted-foreground">说明：{r.detail}</p>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {['post', 'comment', 'response', 'review', 'message'].includes(r.targetType) && (
                    <DecideDialog title="隐藏内容" trigger="隐藏" onConfirm={(reason) => decide(r.id, 'hide', reason)} />
                  )}
                  {r.targetType !== 'tool' && r.targetType !== 'circle' && (
                    <DecideDialog title="禁言作者" trigger="禁言" days onConfirm={(reason, days) => decide(r.id, 'mute', reason, days)} />
                  )}
                  {r.targetType !== 'tool' && r.targetType !== 'circle' && (
                    <DecideDialog title="封禁账号" trigger="封禁" destructive onConfirm={(reason) => decide(r.id, 'ban', reason)} />
                  )}
                  {r.targetType === 'tool' && <DecideDialog title="停用工具" trigger="停用" destructive onConfirm={(reason) => decide(r.id, 'tool_suspend', reason)} />}
                  <DecideDialog title="驳回举报" trigger="驳回" onConfirm={(reason) => decide(r.id, 'dismiss', reason)} />
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel padded={false}>
        <PanelHeader as="h2" title="申诉" description={appeals ? `${appeals.length} 条待处理` : undefined} />
        {appeals && appeals.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-5">没有待处理的申诉。</p>}
        <ul>
          {appeals?.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 border-b px-4 py-3 text-sm last:border-b-0 md:px-5">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={`/u/${a.userId}`} className="font-medium hover:underline">
                  {a.userName}
                </Link>
                <span className="text-muted-foreground">
                  申诉「{ACTION_LABEL[a.action]}」（{TARGET_LABEL[a.targetType]}，原因：{a.reason}）
                </span>
                <span className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{a.text}</p>
              <div className="mt-1 flex gap-1">
                <DecideDialog
                  title="接受申诉"
                  description="接受后只撤销这一条处置。"
                  trigger="接受"
                  onConfirm={async (note) => {
                    const res = await api.admin.appeals[':id'].decide.$post({ param: { id: a.id }, json: { accept: true, note } })
                    if (!res.ok) setError(await errorText(res))
                    else void load()
                    return res.ok
                  }}
                />
                <DecideDialog
                  title="驳回申诉"
                  trigger="驳回"
                  onConfirm={async (note) => {
                    const res = await api.admin.appeals[':id'].decide.$post({ param: { id: a.id }, json: { accept: false, note } })
                    if (!res.ok) setError(await errorText(res))
                    else void load()
                    return res.ok
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel padded={false}>
        <PanelHeader as="h2" title="最新内容" description="巡查用；被隐藏的会标出来" />
        <ul>
          {content?.posts.slice(0, 20).map((p) => (
            <li key={p.id} className="flex items-baseline gap-2 border-b px-4 py-2 text-sm last:border-b-0 md:px-5">
              <Link href={`/p/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {p.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {p.authorName ?? '工具'} · {timeAgo(p.createdAt)}
              </span>
              {p.hiddenAt ? (
                <span className="text-xs text-muted-foreground">已隐藏</span>
              ) : (
                <DecideDialog title="隐藏帖子" trigger="隐藏" onConfirm={(reason) => moderate('post', p.id, reason)} />
              )}
            </li>
          ))}
          {content?.comments.slice(0, 20).map((c) => (
            <li key={c.id} className="flex items-baseline gap-2 border-b px-4 py-2 text-sm last:border-b-0 md:px-5">
              <Link href={`/p/${c.postId}#comments`} className="min-w-0 flex-1 truncate hover:underline">
                回复：{c.content}
              </Link>
              <span className="text-xs text-muted-foreground">
                {c.authorName} · {timeAgo(c.createdAt)}
              </span>
              {c.hiddenAt ? (
                <span className="text-xs text-muted-foreground">已隐藏</span>
              ) : (
                <DecideDialog title="隐藏回复" trigger="隐藏" onConfirm={(reason) => moderate('comment', c.id, reason)} />
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel padded={false}>
        <PanelHeader as="h2" title="处置记录" description={moderations ? `最近 ${moderations.length} 条` : undefined} />
        <ul>
          {moderations?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline gap-2 border-b px-4 py-2 text-sm last:border-b-0 md:px-5">
              <span className="font-medium">{ACTION_LABEL[m.action] ?? m.action}</span>
              <span className="text-muted-foreground">{TARGET_LABEL[m.targetType]}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.reason}</span>
              <span className="text-xs text-muted-foreground">
                {m.byName} · {timeAgo(m.createdAt)}
              </span>
              {!m.reversalOf && ['hide', 'mute', 'ban', 'tool_suspend'].includes(m.action) && (
                <DecideDialog
                  title={`撤销：${ACTION_LABEL[m.action]}`}
                  trigger="撤销"
                  onConfirm={async (reason) => {
                    const res = await api.admin.moderations[':id'].reverse.$post({ param: { id: m.id }, json: { reason } })
                    if (!res.ok) setError(await errorText(res))
                    else void load()
                    return res.ok
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <RulesPanel rules={rules} onChanged={load} onError={setError} />
    </>
  )
}

function RulesPanel({ rules, onChanged, onError }: { rules: RuleItem[] | null; onChanged: () => void; onError: (e: string) => void }) {
  const [pattern, setPattern] = useState('')
  const [kind, setKind] = useState<'reject' | 'flag'>('flag')
  return (
    <Panel padded={false}>
      <PanelHeader as="h2" title="内容规则" description="命中 reject 的直接拒绝，命中 flag 的自动进举报队列" />
      <ul>
        {rules?.map((r) => (
          <li key={r.id} className="flex items-center gap-2 border-b px-4 py-2 text-sm md:px-5">
            <span className="font-medium">{r.pattern}</span>
            <span className="text-xs text-muted-foreground">{r.kind === 'reject' ? '拒绝' : '标记'}</span>
            {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={async () => {
                const res = await api.admin.rules[':id'].$delete({ param: { id: r.id } })
                if (!res.ok) onError(await errorText(res))
                else onChanged()
              }}
            >
              删除
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2 px-4 py-3 md:px-5"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!pattern.trim()) return
          const res = await api.admin.rules.$post({ json: { pattern: pattern.trim(), kind } })
          if (!res.ok) {
            onError(await errorText(res))
            return
          }
          setPattern('')
          onChanged()
        }}
      >
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <Label htmlFor="rule-pattern">词</Label>
          <Input id="rule-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={100} />
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="rule-kind" checked={kind === 'flag'} onChange={() => setKind('flag')} /> 标记
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="rule-kind" checked={kind === 'reject'} onChange={() => setKind('reject')} /> 拒绝
        </label>
        <Button type="submit" size="sm" disabled={!pattern.trim()}>
          添加
        </Button>
      </form>
    </Panel>
  )
}

function DecideDialog({
  title,
  description,
  trigger,
  days,
  destructive,
  onConfirm,
}: {
  title: string
  description?: string
  trigger: string
  days?: boolean
  destructive?: boolean
  onConfirm: (reason: string, days?: 1 | 7 | 30) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [dayCount, setDayCount] = useState<1 | 7 | 30>(7)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost" className={destructive ? 'text-destructive' : 'text-muted-foreground'}>
            {trigger}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {days && (
            <fieldset className="flex gap-3 text-sm">
              <legend className="mb-1 font-medium">天数</legend>
              {([1, 7, 30] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="radio" name={`days-${title}`} checked={dayCount === d} onChange={() => setDayCount(d)} /> {d} 天
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`reason-${title}`}>原因（对方会看到）</Label>
            <Textarea id={`reason-${title}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MODERATION_REASON_MAX} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true)
              const ok = await onConfirm(reason.trim(), days ? dayCount : undefined)
              setBusy(false)
              if (ok) {
                setOpen(false)
                setReason('')
              }
            }}
          >
            {busy ? '处理中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
