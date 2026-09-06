import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cn('rounded-lg border bg-card', padded && 'px-5 py-4', className)}
    >
      {children}
    </section>
  )
}

export function PanelTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  )
}

// 列表面板的页头：标题、说明、右侧动作
export function PanelHeader({
  title,
  description,
  action,
  as: Heading = 'h1',
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  as?: 'h1' | 'h2'
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <Heading className="text-base font-semibold">{title}</Heading>
        {description && <span className="truncate text-[13px] text-muted-foreground">{description}</span>}
      </div>
      {action}
    </div>
  )
}

// 加载中的占位，行数按列表大概的样子给
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function ListSkeleton({ rows = 4, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <ul aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex gap-3 border-b px-5 py-4 last:border-b-0">
          {avatar && <Skeleton className="size-10 rounded-full" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}
