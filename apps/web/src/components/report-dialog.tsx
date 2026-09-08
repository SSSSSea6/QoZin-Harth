'use client'

import { REPORT_DETAIL_MAX, REPORT_REASONS, type ReportReason, type ReportTargetType } from '@harth/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'

const TARGET_LABEL: Record<ReportTargetType, string> = {
  post: '帖子',
  comment: '回复',
  response: '应答',
  review: '评价',
  message: '消息',
  user: '用户',
  tool: '工具',
  circle: '圈子',
}

export function ReportDialog({
  targetType,
  targetId,
  open,
  onOpenChange,
}: {
  targetType: ReportTargetType
  targetId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState<ReportReason>('spam')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    const res = await api.reports.$post({ json: { targetType, targetId, reason, detail: detail.trim() || undefined } })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setDone(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setDone(false)
          setDetail('')
          setError('')
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>举报{TARGET_LABEL[targetType]}</DialogTitle>
          <DialogDescription>管理员会看到这条内容和你的说明，对方不会知道是谁举报的。</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="text-sm">已收到，管理员处理后会通知你。</p>
        ) : (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">原因</legend>
              {(Object.keys(REPORT_REASONS) as ReportReason[]).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="report-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
                  {REPORT_REASONS[key]}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-detail">补充说明（选填）</Label>
              <Textarea id="report-detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={REPORT_DETAIL_MAX} rows={3} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {done ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy}>
              {busy ? '提交中…' : '提交举报'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
