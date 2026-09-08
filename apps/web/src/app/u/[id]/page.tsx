'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { maskPhone } from '@harth/shared'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { GateError } from '@/components/gate-error'
import { DeleteAccountDialog } from '@/components/delete-account-dialog'
import { ItemMenu } from '@/components/item-menu'
import { MyBlocks, MyModerations, MyReports } from '@/components/moderation-panels'
import { MyConsents } from '@/components/consent-panels'
import { BindPhoneDialog } from '@/components/phone-dialog'
import { Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { Stars } from '@/components/stars'
import { Button } from '@/components/ui/button'
import { api, API_URL, errorText, readError, type ApiError } from '@/lib/api'
import { authClient, signOut } from '@/lib/auth-client'
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
  const { session, pending, refetch } = useRequireSession()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [dmError, setDmError] = useState<ApiError | null>(null)

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
    <Columns
      aside={
        isSelf ? (
          <AccountPanel
            email={session.user.email}
            phone={session.user.phoneNumberVerified ? (session.user.phoneNumber ?? null) : null}
            onPhoneChanged={() => void refetch()}
          />
        ) : undefined
      }
    >
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
                if (!res.ok) {
                  setDmError(await readError(res))
                  return
                }
                const { circle } = await res.json()
                router.push(`/c/${circle.id}`)
              }}
            >
              私聊
            </Button>
          )}
          {!isSelf && <ItemMenu targetType="user" targetId={profile.id} subjectId={profile.id} />}
        </div>
        <GateError error={dmError} className="mt-2 text-right text-xs text-destructive" />

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
      {isSelf && (
        <>
          <MyModerations />
          <MyReports />
          <MyBlocks />
          <MyConsents />
        </>
      )}
    </Columns>
  )
}

function AccountPanel({
  email,
  phone,
  onPhoneChanged,
}: {
  email: string
  phone: string | null
  onPhoneChanged: () => void
}) {
  const router = useRouter()
  const [phoneError, setPhoneError] = useState('')
  return (
    <Panel>
      <PanelTitle>账号</PanelTitle>
      <p className="text-sm text-muted-foreground">{email}</p>
      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0">
          <p className="text-sm">{phone ? maskPhone(phone) : '未绑定手机号'}</p>
          {!phone && <p className="text-[13px] text-muted-foreground">发言前要先绑定，号码不会展示</p>}
        </div>
        {phone ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={async () => {
              setPhoneError('')
              const { error } = await authClient.$fetch('/update-user', { method: 'POST', body: { phoneNumber: null } })
              if (error) setPhoneError(error.message ?? '解绑失败')
              else onPhoneChanged()
            }}
          >
            解绑
          </Button>
        ) : (
          <BindPhoneDialog onBound={onPhoneChanged} />
        )}
      </div>
      {phoneError && <p className="text-sm text-destructive">{phoneError}</p>}
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
