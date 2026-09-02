'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from './auth-client'

export function useRequireSession() {
  const { data: session, isPending } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (!isPending && !session) router.replace('/')
  }, [isPending, session, router])

  return { session, pending: isPending }
}

// 加载放到下一轮事件循环，避开 react-hooks/set-state-in-effect
export function useLoad(load: () => Promise<void> | void): void {
  useEffect(() => {
    const handle = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(handle)
  }, [load])
}
