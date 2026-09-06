'use client'

import type { ReactNode } from 'react'
import { LeftNav } from '@/components/left-nav'
import { useSession } from '@/lib/auth-client'

export function Shell({ children }: { children: ReactNode }) {
  const { data: session } = useSession()

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-6">
        <main className="min-w-0">{children}</main>
      </div>
    )
  }

  return (
    <div className="flex flex-1">
      <LeftNav />
      <div className="min-w-0 flex-1 px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
        <main className="mx-auto w-full max-w-[1200px]">{children}</main>
      </div>
    </div>
  )
}
