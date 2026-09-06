'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { Stars } from '@/components/stars'
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
import { api, API_URL, errorText } from '@/lib/api'
import { signOut } from '@/lib/auth-client'
import { timeAgo } from '@/lib/format'
import { useRequireSession } from '@/lib/hooks'

interface Profile {
  id: string
  name: string
  createdAt: string
  reputation: {
    avgRating: number | null
    reviewCount: number
    completedCount: number
  }
  recentReviews: {
    id: string
    rating: number
    comment: string | null
    createdAt: string
    reviewerName: string
  }[]
}

export default function ProfilePage() {
  const { session, pending } = useRequireSession()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session) return
    void api.users[':id'].profile.$get({ param: { id } }).then(async (res) => {
      if (!res.ok) setError(await errorText(res))
      else setProfile((await res.json()).profile as Profile)
    })
  }, [session, id])

  if (pending || !session) return null
  if (error) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
      </Panel>
    )
  }
  if (!profile) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </Panel>
    )
  }

  const isSelf = session.user.id === profile.id
  const { reputation } = profile

  return (
    <Columns aside={isSelf ? <AccountPanel email={session.user.email} /> : undefined}>
      <Panel>
        <div className="flex items-start gap-4">
          <Avatar seed={profile.id} name={profile.name} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold leading-tight">{profile.name}</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {new Date(profile.createdAt).toLocaleDateString('zh-CN')} 加入火塘
            </p>
          </div>
          {!isSelf && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await api.circles.dm.$post({
                  json: { userId: profile.id },
                })
                if (res.ok) {
                  const { circle } = await res.json()
                  router.push(`/c/${circle.id}`)
                }
              }}
            >
              私聊
            </Button>
          )}
        </div>

        <div className="mt-5 border-t pt-4">
          <dl className="grid max-w-[360px] grid-cols-3 gap-4">
            <div className="flex flex-col">
              <dd className="text-2xl font-semibold leading-8">
                {reputation.avgRating === null ? (
                  <span className="text-base font-medium text-muted-foreground">暂无</span>
                ) : (
                  reputation.avgRating.toFixed(1)
                )}
              </dd>
              <dt className="mt-1 text-[13px] text-muted-foreground">评分</dt>
            </div>
            <div className="flex flex-col">
              <dd className="text-2xl font-semibold leading-8">{reputation.reviewCount}</dd>
              <dt className="mt-1 text-[13px] text-muted-foreground">收到评价</dt>
            </div>
            <div className="flex flex-col">
              <dd className="text-2xl font-semibold leading-8">{reputation.completedCount}</dd>
              <dt className="mt-1 text-[13px] text-muted-foreground">完成交接</dt>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel padded={false}>
        <PanelHeader as="h2" title="大家怎么说" />
        {profile.recentReviews.length === 0 ? (
          <p className="px-4 py-8 md:px-5 text-center text-sm text-muted-foreground">
            还没有收到评价。完成第一次交接后会出现在这里。
          </p>
        ) : (
          <ul>
            {profile.recentReviews.map((review) => (
              <li
                key={review.id}
                className="flex flex-col gap-1 border-b px-4 py-3 md:px-5 text-sm last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <Stars rating={review.rating} />
                  <span className="text-xs text-muted-foreground">
                    {review.reviewerName} · {timeAgo(review.createdAt)}
                  </span>
                </div>
                {review.comment && (
                  <p className="break-words">{review.comment}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Columns>
  )
}

function AccountPanel({ email }: { email: string }) {
  const router = useRouter()
  return (
    <Panel>
      <PanelTitle>账号</PanelTitle>
      <p className="text-sm text-muted-foreground">{email}</p>
      <div className="mt-3 flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={`${API_URL}/api/users/me/export`} download />}
        >
          导出我的数据
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await signOut()
            router.replace('/')
          }}
        >
          退出登录
        </Button>
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        数据怎么处理，见{' '}
        <a
          href="https://github.com/SSSSSea6/QoZin-Harth/blob/main/PRIVACY.md"
          className="underline underline-offset-2 hover:text-foreground"
        >
          隐私说明
        </a>
        。
      </p>
      <div className="mt-6 border-t pt-4">
        <DeleteAccountDialog />
      </div>
    </Panel>
  )
}

function DeleteAccountDialog() {
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
