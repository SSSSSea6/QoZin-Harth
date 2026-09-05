'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel } from '@/components/panel'
import { PostStatusBadge } from '@/components/post-status'
import { StarInput } from '@/components/stars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { formatPrice, timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'

interface PostDetail {
  id: string
  circleId: string
  circleName: string
  circleArchived: boolean
  templateKey: string
  title: string
  fields: Record<string, unknown>
  status: 'open' | 'matched' | 'completed' | 'cancelled'
  createdAt: string
  author: { id: string; name: string } | null
  tool: { slug: string; name: string } | null
  isAuthor: boolean
  matchedResponderId: string | null
  iAmMatchedResponder: boolean
  authorConfirmed: boolean
  responderConfirmed: boolean
  responseCount: number
  responses: {
    id: string
    message: string
    createdAt: string
    responderId: string
    responderName: string
  }[]
  comments: {
    id: string
    content: string
    createdAt: string
    authorId: string
    authorName: string
  }[]
  reviewedByMe: boolean
}

export default function PostPage() {
  const { session, pending } = useRequireSession()
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const res = await api.posts[':id'].$get({ param: { id } })
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setPost((await res.json()).post as PostDetail)
  }, [session, id])

  useLoad(load)

  if (pending || !session) return null
  if (error) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
      </Panel>
    )
  }
  if (!post) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </Panel>
    )
  }

  const isSecondhand = post.templateKey === 'secondhand'
  const body = String(
    (isSecondhand ? post.fields.description : post.fields.body) ?? '',
  )
  const isParty = post.isAuthor || post.iAmMatchedResponder

  return (
    <Columns
      aside={post.author ? <AuthorCard authorId={post.author.id} isSelf={post.isAuthor} /> : undefined}
    >
      <Panel>
        <Link
          href={`/c/${post.circleId}`}
          className="text-[13px] text-muted-foreground hover:text-foreground hover:underline"
        >
          {post.circleName}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold leading-snug">{post.title}</h1>
          {isSecondhand && <PostStatusBadge status={post.status} />}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          {post.author ? (
            <>
              <Link href={`/u/${post.author.id}`}>
                <Avatar seed={post.author.id} size={28} />
              </Link>
              <Link
                href={`/u/${post.author.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {post.author.name}
              </Link>
            </>
          ) : (
            <>
              <Link href={`/tools/${post.tool?.slug}`}>
                <Avatar seed={`tool:${post.tool?.slug}`} size={28} className="rounded-md" />
              </Link>
              <Link href={`/tools/${post.tool?.slug}`} className="font-medium text-foreground hover:underline">
                {post.tool?.name}
              </Link>
            </>
          )}
          {post.tool && (
            <Badge variant="outline" className="rounded-sm">
              {post.author ? `经 ${post.tool.name}` : '工具'}
            </Badge>
          )}
          <span aria-hidden>·</span>
          <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
        </div>

        {isSecondhand && (
          <p className="mt-4 text-xl font-semibold text-primary">
            {formatPrice(Number(post.fields.priceFen ?? 0))}
          </p>
        )}

        {body && (
          <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-7">
            {body}
          </p>
        )}

        {isSecondhand && (
          <div className="mt-5 border-t pt-4">
            {post.status === 'cancelled' && (
              <p className="text-sm text-muted-foreground">发布者已取消。</p>
            )}
            {post.status === 'open' &&
              (post.isAuthor ? (
                <AuthorOpenView post={post} onChanged={load} />
              ) : (
                <ResponderOpenView post={post} onChanged={load} />
              ))}
            {post.status === 'matched' && (
              <MatchedView post={post} isParty={isParty} onChanged={load} />
            )}
            {post.status === 'completed' && (
              <CompletedView post={post} isParty={isParty} onChanged={load} />
            )}
          </div>
        )}
      </Panel>

      <CommentsPanel post={post} onChanged={load} />
    </Columns>
  )
}

interface Profile {
  id: string
  name: string
  reputation: {
    avgRating: number | null
    reviewCount: number
    completedCount: number
  }
}

function AuthorCard({ authorId, isSelf }: { authorId: string; isSelf: boolean }) {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    void api.users[':id'].profile
      .$get({ param: { id: authorId } })
      .then(async (res) => {
        if (res.ok) setProfile((await res.json()).profile as Profile)
      })
  }, [authorId])

  if (!profile) return null
  const { reputation } = profile

  return (
    <Panel>
      <div className="flex items-center gap-3">
        <Link href={`/u/${profile.id}`}>
          <Avatar seed={profile.id} size={48} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/u/${profile.id}`}
            className="block truncate text-[15px] font-medium hover:underline"
          >
            {profile.name}
          </Link>
          <div className="text-xs text-muted-foreground">
            {reputation.avgRating === null
              ? '还没有评价'
              : `评分 ${reputation.avgRating.toFixed(1)} · ${reputation.reviewCount} 评价`}
            {reputation.completedCount > 0 &&
              ` · ${reputation.completedCount} 次交接`}
          </div>
        </div>
      </div>
      {!isSelf && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={async () => {
            const res = await api.circles.dm.$post({ json: { userId: profile.id } })
            if (res.ok) {
              const { circle } = await res.json()
              router.push(`/c/${circle.id}`)
            }
          }}
        >
          私聊
        </Button>
      )}
    </Panel>
  )
}

function CommentsPanel({
  post,
  onChanged,
}: {
  post: PostDetail
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const content = draft.trim()
    if (!content) return
    setBusy(true)
    const res = await api.posts[':id'].comments.$post({
      param: { id: post.id },
      json: { content },
    })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setDraft('')
    setError('')
    onChanged()
  }

  return (
    <Panel padded={false}>
      <div className="border-b px-4 py-3">
        <h2 className="text-[15px] font-semibold">
          回复 {post.comments.length > 0 ? post.comments.length : ''}
        </h2>
      </div>

      {post.comments.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          还没有回复。
        </p>
      ) : (
        <ul>
          {post.comments.map((c) => (
            <li key={c.id} className="flex gap-3 border-b px-4 py-3 last:border-b-0">
              <Link href={`/u/${c.authorId}`} className="mt-0.5">
                <Avatar seed={c.authorId} size={32} />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-[13px]">
                  <Link
                    href={`/u/${c.authorId}`}
                    className="font-medium hover:underline"
                  >
                    {c.authorName}
                  </Link>
                  <span className="text-muted-foreground">
                    {timeAgo(c.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                  {c.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {post.circleArchived ? (
        <div className="border-t bg-muted px-4 py-2 text-sm text-muted-foreground">
          圈子已归档，不能再回复。
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="写下你的回复…"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={busy || !draft.trim()}>
              回复
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function AuthorOpenView({
  post,
  onChanged,
}: {
  post: PostDetail
  onChanged: () => void
}) {
  const [error, setError] = useState('')
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">应答（{post.responseCount}）</h2>
      {post.responses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          还没有人应答。耐心等等，或在圈里说一声。
        </p>
      ) : (
        <ul className="divide-y">
          {post.responses.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-3">
              <Avatar seed={r.responderId} size={32} />
              <div className="min-w-0 flex-1 text-sm">
                <span className="flex items-baseline gap-2">
                  <Link
                    href={`/u/${r.responderId}`}
                    className="font-medium hover:underline"
                  >
                    {r.responderName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(r.createdAt)}
                  </span>
                </span>
                <p className="break-words">{r.message}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const res = await api.posts[':id'].accept.$post({
                    param: { id: post.id },
                    json: { responseId: r.id },
                  })
                  if (!res.ok) setError(await errorText(res))
                  else onChanged()
                }}
              >
                选定
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={async () => {
            const res = await api.posts[':id'].cancel.$post({
              param: { id: post.id },
            })
            if (res.ok) onChanged()
          }}
        >
          取消发布
        </Button>
      </div>
    </section>
  )
}

function ResponderOpenView({
  post,
  onChanged,
}: {
  post: PostDetail
  onChanged: () => void
}) {
  const mine = post.responses[0]
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  if (mine) {
    return (
      <p className="text-sm text-muted-foreground">
        已应答：「{mine.message}」，等发布者选定。
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">我要</h2>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="说一句怎么交接，例：今晚七点，二食堂门口？"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button
          size="sm"
          disabled={!message.trim()}
          onClick={async () => {
            const res = await api.posts[':id'].responses.$post({
              param: { id: post.id },
              json: { message: message.trim() },
            })
            if (!res.ok) setError(await errorText(res))
            else onChanged()
          }}
        >
          应答
        </Button>
      </div>
    </section>
  )
}

function MatchedView({
  post,
  isParty,
  onChanged,
}: {
  post: PostDetail
  isParty: boolean
  onChanged: () => void
}) {
  const router = useRouter()
  const matched = post.responses.find(
    (r) => r.responderId === post.matchedResponderId,
  )
  const otherName = post.isAuthor
    ? (matched?.responderName ?? '对方')
    : (post.author?.name ?? '对方')
  const myConfirmed = post.isAuthor
    ? post.authorConfirmed
    : post.responderConfirmed

  if (!isParty) {
    return <p className="text-sm text-muted-foreground">双方正在交接中。</p>
  }

  return (
    <section className="flex flex-col gap-3 text-sm">
      <p>
        已和 <span className="font-medium">{otherName}</span> 约定交接。
        见面完成后，双方各自确认。
      </p>
      <ul className="text-xs text-muted-foreground">
        <li>发布者：{post.authorConfirmed ? '已确认' : '待确认'}</li>
        <li>应答者：{post.responderConfirmed ? '已确认' : '待确认'}</li>
      </ul>
      <div className="flex gap-2">
        {!myConfirmed && (
          <Button
            size="sm"
            onClick={async () => {
              const res = await api.posts[':id'].confirm.$post({
                param: { id: post.id },
              })
              if (res.ok) onChanged()
            }}
          >
            确认完成
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const target = post.isAuthor
              ? post.matchedResponderId
              : (post.author?.id ?? null)
            if (!target) return
            const res = await api.circles.dm.$post({ json: { userId: target } })
            if (res.ok) {
              const { circle } = await res.json()
              router.push(`/c/${circle.id}`)
            }
          }}
        >
          私聊{otherName}
        </Button>
      </div>
    </section>
  )
}

function CompletedView({
  post,
  isParty,
  onChanged,
}: {
  post: PostDetail
  isParty: boolean
  onChanged: () => void
}) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm">交接完成。</p>
      {isParty &&
        (post.reviewedByMe ? (
          <p className="text-sm text-muted-foreground">你已评价过对方。</p>
        ) : (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">给对方一个评价</h2>
            <StarInput value={rating} onChange={setRating} />
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="一句话就好（选填）"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div>
              <Button
                size="sm"
                onClick={async () => {
                  const res = await api.posts[':id'].reviews.$post({
                    param: { id: post.id },
                    json: {
                      rating,
                      comment: comment.trim() || undefined,
                    },
                  })
                  if (!res.ok) setError(await errorText(res))
                  else onChanged()
                }}
              >
                提交评价
              </Button>
            </div>
          </div>
        ))}
    </section>
  )
}
