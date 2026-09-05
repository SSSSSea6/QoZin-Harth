import { postExcerpt, type TemplateKey } from '@harth/shared'
import { Handshake, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/avatar'
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
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    )
  }
  return (
    <ul>
      {posts.map((post) => {
        const key = post.templateKey as TemplateKey
        const excerpt = postExcerpt(key, post.fields)
        const isSecondhand = key === 'secondhand'
        return (
          <li key={post.id} className="flex gap-3 border-b px-4 py-4 last:border-b-0">
            {post.authorId ? (
              <Link href={`/u/${post.authorId}`} className="mt-0.5">
                <Avatar seed={post.authorId} size={36} />
              </Link>
            ) : (
              <Link href={`/tools/${post.toolSlug}`} className="mt-0.5">
                <Avatar seed={`tool:${post.toolSlug}`} size={36} className="rounded-lg" />
              </Link>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                {post.authorId ? (
                  <Link
                    href={`/u/${post.authorId}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {post.authorName}
                  </Link>
                ) : (
                  <Link href={`/tools/${post.toolSlug}`} className="font-medium text-foreground hover:underline">
                    {post.toolName}
                  </Link>
                )}
                {post.toolName && (
                  <Badge variant="outline" className="rounded-sm">
                    {post.authorId ? `经 ${post.toolName}` : '工具'}
                  </Badge>
                )}
                {showCircle && (
                  <>
                    <span aria-hidden>·</span>
                    <Link
                      href={`/c/${post.circleId}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {post.circleName}
                    </Link>
                  </>
                )}
                <span aria-hidden>·</span>
                <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
              </div>

              <Link
                href={`/p/${post.id}`}
                className="mt-1 block text-[16px] font-medium leading-snug hover:underline"
              >
                {post.title}
              </Link>

              {excerpt && (
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {excerpt}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                {isSecondhand && (
                  <span className="font-medium text-primary">
                    {formatPrice(Number(post.fields.priceFen ?? 0))}
                  </span>
                )}
                {isSecondhand && <PostStatusBadge status={post.status} />}
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="size-3.5" aria-hidden />
                  {post.commentCount}
                </span>
                {isSecondhand && (
                  <span className="inline-flex items-center gap-1">
                    <Handshake className="size-3.5" aria-hidden />
                    {post.responseCount} 应答
                  </span>
                )}
                {isSecondhand && (
                  <Badge variant="outline" className="rounded-sm">
                    二手
                  </Badge>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
