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
      className={cn(
        'rounded-lg border bg-background',
        padded && 'px-4 py-4',
        className,
      )}
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
