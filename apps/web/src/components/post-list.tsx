import { postExcerpt, type TemplateKey } from '@harth/shared'
import { Handshake, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/avatar'
import { ListSkeleton } from '@/components/panel'
import { PostStatusBadge } from '@/components/post-status'
import { Badge } from '@/components/ui/badge'
import { formatPrice, timeAgo } from '@/lib/format'

export interface PostListItemData {
  id: string
  circleId: string
  circleName: string
  templateKey: string
  title: string
  fields: Record<string, unknown>
  status: 'open' | 'matched' | 'completed' | 'cancelled'
  createdAt: string
  authorId: string | null
  authorName: string | null
  toolSlug?: string | null
  toolName?: string | null
  commentCount: number
  responseCount: number
}

export function PostListSkeleton() {
  return <ListSkeleton rows={5} />
}

export function PostList({
  posts,
  showCircle = true,
  emptyText = '还没有帖子。',
}: {
  posts: PostListItemData[]
  showCircle?: boolean
  emptyText?: string
}) {
  if (posts.length === 0) {
    return (
      <p className="px-5 py-12 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    )
  }
  return (
    <ul>
      {posts.map((post) => {
        const key = post.templateKey as TemplateKey
        const excerpt = postExcerpt(key, post.fields, 160)
        const isSecondhand = key === 'secondhand'
        const byTool = !post.authorId
        const author = byTool
          ? { href: `/tools/${post.toolSlug}`, name: post.toolName ?? '工具' }
          : { href: `/u/${post.authorId}`, name: post.authorName ?? '已注销用户' }
        return (
          <li key={post.id} className="border-b last:border-b-0">
            <article className="flex gap-3 px-5 py-4 transition-colors hover:bg-hover">
              <Link href={author.href} className="mt-0.5">
                <Avatar
                  seed={byTool ? `tool:${post.toolSlug}` : post.authorId!}
                  name={author.name}
                  size={40}
                  shape={byTool ? 'square' : 'circle'}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-muted-foreground">
                  <Link href={author.href} className="text-sm font-semibold text-foreground hover:underline">
                    {author.name}
                  </Link>
                  {post.toolName && (
                    <Badge variant="outline">{byTool ? '工具' : `经 ${post.toolName}`}</Badge>
                  )}
                  {showCircle && (
                    <>
                      <span aria-hidden>·</span>
                      <Link href={`/c/${post.circleId}`} className="hover:text-foreground hover:underline">
                        {post.circleName}
                      </Link>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
                </div>

                <Link
                  href={`/p/${post.id}`}
                  className="mt-1 block text-[17px] font-semibold leading-snug hover:underline"
                >
                  {post.title}
                </Link>

                {excerpt && (
                  <p className="mt-1.5 line-clamp-3 text-[15px] leading-6 text-foreground-2">
                    {excerpt}
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
                  {isSecondhand && (
                    <span className="text-[15px] font-semibold text-brand">
                      {formatPrice(Number(post.fields.priceFen ?? 0))}
                    </span>
                  )}
                  {isSecondhand && <PostStatusBadge status={post.status} />}
                  <Link href={`/p/${post.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                    <MessageSquare className="size-4" aria-hidden />
                    {post.commentCount > 0 ? post.commentCount : '回复'}
                  </Link>
                  {isSecondhand && (
                    <span className="inline-flex items-center gap-1">
                      <Handshake className="size-4" aria-hidden />
                      {post.responseCount} 应答
                    </span>
                  )}
                </div>
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
