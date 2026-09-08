'use client'

import { Bell } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

// 顶栏的通知入口：未读数只在这一处显示，进入收件箱后清零
export function NotificationBell() {
  const pathname = usePathname()
  const [count, setCount] = useState(0)

  const load = useCallback(async () => {
    const res = await api.notifications['unread-count'].$get()
    if (res.ok) setCount((await res.json()).count)
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => void load(), 0)
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      clearTimeout(handle)
      clearInterval(timer)
    }
  }, [load, pathname])

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `通知，${count} 条未读` : '通知'}
      className="relative flex size-11 items-center justify-center rounded-md hover:bg-hover"
    >
      <Bell className="size-5" aria-hidden />
      {count > 0 && (
        <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-brand px-1 text-center text-[11px] font-medium leading-4 text-background">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
