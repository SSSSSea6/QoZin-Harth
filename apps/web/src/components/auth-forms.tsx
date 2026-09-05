'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { signIn, signUp } from '@/lib/auth-client'

// better-auth 的错误码转成中文，认不出的用它自带的英文
const AUTH_ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: '这个邮箱已经注册过了，去「登录」',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '这个邮箱已经注册过了，去「登录」',
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不对',
  USER_NOT_FOUND: '邮箱或密码不对',
  INVALID_EMAIL: '邮箱格式不对',
  PASSWORD_TOO_SHORT: '密码至少 8 位',
  PASSWORD_TOO_LONG: '密码太长了',
}

export function AuthForms({ next = '/' }: { next?: string }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handle(
    action: () => Promise<{ error?: { code?: string; message?: string } | null }>,
  ) {
    setBusy(true)
    setError('')
    const { error: err } = await action()
    if (err) {
      setError((err.code && AUTH_ERRORS[err.code]) || err.message || '出错了，稍后再试')
      setBusy(false)
      return
    }
    router.replace(next)
  }

  return (
    <Tabs defaultValue="login" onValueChange={() => setError('')}>
      <TabsList className="w-full">
        <TabsTrigger value="login" className="flex-1">
          登录
        </TabsTrigger>
        <TabsTrigger value="register" className="flex-1">
          注册
        </TabsTrigger>
      </TabsList>

      <TabsContent value="login">
        <form
          className="flex flex-col gap-4 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            const data = new FormData(e.currentTarget)
            void handle(() =>
              signIn.email({
                email: String(data.get('email')),
                password: String(data.get('password')),
              }),
            )
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="login-email">邮箱</Label>
            <Input id="login-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="login-password">密码</Label>
            <Input
              id="login-password"
              name="password"
              type="password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="register">
        <form
          className="flex flex-col gap-4 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            const data = new FormData(e.currentTarget)
            void handle(() =>
              signUp.email({
                name: String(data.get('name')),
                email: String(data.get('email')),
                password: String(data.get('password')),
              }),
            )
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="reg-name">昵称</Label>
            <Input id="reg-name" name="name" maxLength={20} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reg-email">邮箱</Label>
            <Input id="reg-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reg-password">密码</Label>
            <Input
              id="reg-password"
              name="password"
              type="password"
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">至少 8 位</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? '注册中…' : '注册'}
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  )
}
