import type { ReactNode } from 'react'

// 桌面右栏 320，窄屏时右栏内容排在主列下面
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
          ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6'
          : 'grid gap-4 xl:mx-auto xl:max-w-[800px]'
      }
    >
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {aside && (
        <aside className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
          {aside}
        </aside>
      )}
    </div>
  )
}
