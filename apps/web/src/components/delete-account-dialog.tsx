'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorText } from '@/lib/api'
import { signOut } from '@/lib/auth-client'

export function DeleteAccountDialog() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    setError('')
    const res = await api.users.me.delete.$post({ json: { password } })
    if (!res.ok) {
      setError(await errorText(res))
      setBusy(false)
      return
    }
    await signOut().catch(() => {})
    router.replace('/')
    router.refresh()
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="justify-start text-destructive">
            注销账号
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>注销账号</DialogTitle>
          <DialogDescription>
            昵称、邮箱、密码和登录记录会被删除，你会退出所有圈子；发过的帖子、回复和评价会以「已注销用户」的名义保留。这一步不能撤销。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="delete-password">输入密码确认</Label>
          <Input
            id="delete-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={remove} disabled={busy || !password}>
            {busy ? '注销中…' : '确认注销'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
