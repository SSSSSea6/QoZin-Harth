import { postExcerpt, type TemplateKey } from '@harth/shared'
import { Handshake, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
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
  emptyAction,
}: {
  posts: PostListItemData[]
  showCircle?: boolean
  emptyText?: string
  emptyAction?: ReactNode
}) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center md:px-5">
        <p className="text-sm text-muted-foreground">{emptyText}</p>
        {emptyAction}
      </div>
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
            {/* 整行可进详情：标题链接铺满整行，其余链接叠在它上面；窄屏正文通宽 */}
            <article className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-4 transition-colors hover:bg-hover md:px-5">
              <Link href={author.href} className="relative z-10 self-start md:row-span-3 md:mt-0.5">
                <Avatar
                  seed={byTool ? `tool:${post.toolSlug}` : post.authorId!}
                  name={author.name}
                  size={40}
                  shape={byTool ? 'square' : 'circle'}
                />
              </Link>

              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 self-center text-[13px] leading-5 text-muted-foreground md:self-auto">
                <Link href={author.href} className="relative z-10 text-sm font-semibold text-foreground hover:underline">
                  {author.name}
                </Link>
                {post.toolName && (
                  <Badge variant="outline">{byTool ? '工具' : `经 ${post.toolName}`}</Badge>
                )}
                {showCircle && (
                  <>
                    <span aria-hidden>·</span>
                    <Link href={`/c/${post.circleId}`} className="relative z-10 hover:text-foreground hover:underline">
                      {post.circleName}
                    </Link>
                  </>
                )}
                <span aria-hidden>·</span>
                <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
              </div>

              <div className="col-span-2 mt-2 min-w-0 md:col-span-1 md:col-start-2 md:mt-1">
                <Link
                  href={`/p/${post.id}`}
                  className="block text-[17px] font-semibold leading-[26px] after:absolute after:inset-0 md:text-lg md:leading-[27px]"
                >
                  {post.title}
                </Link>
                {isSecondhand && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-semibold text-brand">
                      {formatPrice(Number(post.fields.priceFen ?? 0))}
                    </span>
                    <PostStatusBadge status={post.status} />
                  </div>
                )}
                {excerpt && (
                  <p className="mt-1 line-clamp-3 text-[15px] leading-6 text-foreground-2">
                    {excerpt}
                  </p>
                )}
              </div>

              <div className="col-span-2 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground md:col-span-1 md:col-start-2">
                <Link
                  href={`/p/${post.id}#comments`}
                  className="relative z-10 inline-flex items-center gap-1 hover:text-foreground"
                >
                  <MessageSquare className="size-4" aria-hidden />
                  {post.commentCount > 0 ? `${post.commentCount} 回复` : '回复'}
                </Link>
                {isSecondhand && (
                  <span className="inline-flex items-center gap-1">
                    <Handshake className="size-4" aria-hidden />
                    {post.responseCount} 应答
                  </span>
                )}
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
