'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useState } from 'react'
import { AuthForms } from '@/components/auth-forms'
import { Panel } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient, useSession } from '@/lib/auth-client'
import { useLoad } from '@/lib/hooks'

export default function DeviceRoute() {
  return (
    <Suspense>
      <DevicePage />
    </Suspense>
  )
}

function DevicePage() {
  const { data: session, isPending } = useSession()
  const preset = useSearchParams().get('user_code') ?? ''
  const [code, setCode] = useState(preset)
  const [client, setClient] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  const [busy, setBusy] = useState(false)

  const verify = useCallback(async () => {
    if (!preset) return
    const { data, error: err } = await authClient.$fetch<{ client_id: string; status: string }>(
      '/device',
      { query: { user_code: preset } },
    )
    if (err || !data) {
      setError('验证码不对，或者已经过期')
      return
    }
    setClient(data.client_id)
  }, [preset])

  useLoad(verify)

  if (isPending) return null

  if (!session) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4 pt-10">
        <p className="text-center text-sm text-muted-foreground">登录后才能确认命令行工具的登录请求。</p>
        <Panel>
          <AuthForms next={`/device?user_code=${encodeURIComponent(preset)}`} />
        </Panel>
      </div>
    )
  }

  async function decide(action: 'approve' | 'deny') {
    setBusy(true)
    setError('')
    const { error: err } = await authClient.$fetch(`/device/${action}`, {
      method: 'POST',
      body: { userCode: code.trim() },
    })
    setBusy(false)
    if (err) {
      setError(err.message ?? '出错了，稍后再试')
      return
    }
    setDone(action === 'approve' ? 'approved' : 'denied')
  }

  return (
    <div className="mx-auto w-full max-w-sm pt-10">
      <Panel>
        {done ? (
          <p className="py-4 text-center text-sm">
            {done === 'approved' ? '已允许，回到终端继续。' : '已拒绝。'}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold">确认登录</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {client ? `命令行工具 ${client} 想用你的账号（${session.user.name}）登录。` : '一个命令行工具想用你的账号登录。'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">验证码</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono tracking-widest"
                autoComplete="off"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => decide('approve')} disabled={busy || !code.trim()}>
                允许
              </Button>
              <Button variant="outline" onClick={() => decide('deny')} disabled={busy || !code.trim()}>
                拒绝
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
