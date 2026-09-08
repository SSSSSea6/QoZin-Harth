'use client'

import { SMS_LIMITS, normalizePhone } from '@harth/shared'
import { useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

export function BindPhoneDialog({ onBound }: { onBound: () => void }) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const handle = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(handle)
  }, [cooldown])

  const normalized = normalizePhone(phone)

  async function send() {
    if (!normalized) {
      setError('请输入 11 位大陆手机号')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await authClient.phoneNumber.sendOtp({ phoneNumber: normalized })
    setBusy(false)
    if (err) {
      setError(err.message ?? '发送失败')
      return
    }
    setSent(true)
    setCooldown(SMS_LIMITS.cooldownSeconds)
  }

  async function verify() {
    if (!normalized || code.length !== 6) return
    setBusy(true)
    setError('')
    const { error: err } = await authClient.phoneNumber.verify({ phoneNumber: normalized, code, updatePhoneNumber: true })
    setBusy(false)
    if (err) {
      setError(err.message ?? '验证失败')
      return
    }
    setOpen(false)
    onBound()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setSent(false)
          setCode('')
          setError('')
        }
      }}
    >
      <DialogTrigger render={<Button size="sm">绑定</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定手机号</DialogTitle>
          <DialogDescription>发言前要先绑定手机号。号码只用于验证，不会展示给任何人。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bind-phone">手机号</Label>
            <div className="flex gap-2">
              <Input
                id="bind-phone"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={sent}
              />
              <Button variant="outline" onClick={send} disabled={busy || cooldown > 0 || !normalized}>
                {cooldown > 0 ? `${cooldown} 秒后可重发` : sent ? '重发' : '发验证码'}
              </Button>
            </div>
          </div>
          {sent && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="bind-code">验证码</Label>
              <Input
                id="bind-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={verify} disabled={busy || !sent || code.length !== 6}>
            {busy ? '请稍等…' : '确认绑定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
