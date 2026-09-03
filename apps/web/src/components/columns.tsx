import type { ReactNode } from 'react'

export function Columns({
  children,
  aside,
}: {
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div
      className={
        aside
          ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]'
          : 'grid gap-4 xl:mx-auto xl:max-w-[800px]'
      }
    >
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {aside && (
        <aside className="sticky top-[72px] hidden self-start flex-col gap-4 xl:flex">
          {aside}
        </aside>
      )}
    </div>
  )
}
