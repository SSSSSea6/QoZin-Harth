'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel } from '@/components/panel'
import { Stars } from '@/components/stars'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
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
    <Columns>
      <Panel>
        <div className="flex items-start gap-4">
          <Avatar seed={profile.id} size={64} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{profile.name}</h1>
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

        <dl className="mt-5 grid grid-cols-3 border-t pt-4">
          <div className="flex flex-col">
            <dd className="text-lg font-semibold">
              {reputation.avgRating === null
                ? '—'
                : reputation.avgRating.toFixed(1)}
            </dd>
            <dt className="text-xs text-muted-foreground">评分</dt>
          </div>
          <div className="flex flex-col">
            <dd className="text-lg font-semibold">{reputation.reviewCount}</dd>
            <dt className="text-xs text-muted-foreground">收到评价</dt>
          </div>
          <div className="flex flex-col">
            <dd className="text-lg font-semibold">{reputation.completedCount}</dd>
            <dt className="text-xs text-muted-foreground">完成交接</dt>
          </div>
        </dl>
      </Panel>

      <Panel padded={false}>
        <div className="border-b px-4 py-3">
          <h2 className="text-[15px] font-semibold">大家怎么说</h2>
        </div>
        {profile.recentReviews.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            还没有收到评价。完成第一次交接后会出现在这里。
          </p>
        ) : (
          <ul>
            {profile.recentReviews.map((review) => (
              <li
                key={review.id}
                className="flex flex-col gap-1 border-b px-4 py-3 text-sm last:border-b-0"
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
