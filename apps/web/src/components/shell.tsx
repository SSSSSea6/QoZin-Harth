'use client'

import type { ReactNode } from 'react'
import { LeftNav } from '@/components/left-nav'
import { useSession } from '@/lib/auth-client'

export function Shell({ children }: { children: ReactNode }) {
  const { data: session } = useSession()

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-3 py-6">
        <main className="min-w-0">{children}</main>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] flex-1 px-3 py-4 pb-20 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-4 md:pb-6">
      <LeftNav />
      <main className="min-w-0">{children}</main>
    </div>
  )
}
