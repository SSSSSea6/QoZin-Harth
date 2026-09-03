'use client'

import { Blocks, Home, Plus, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface NavCircle {
  id: string
  name: string
  isDm: boolean
  lifecycle: { state: string }
}

const ITEMS = [
  { href: '/', label: '首页', icon: Home },
  { href: '/circles', label: '圈子', icon: Users },
  { href: '/tools', label: '工具', icon: Blocks },
]

export function LeftNav() {
  const pathname = usePathname()
  const [circles, setCircles] = useState<NavCircle[]>([])

  useEffect(() => {
    void api.circles.mine.$get().then(async (res) => {
      if (res.ok) {
        const { circles: list } = await res.json()
        setCircles(
          list.filter((c) => !c.isDm && c.lifecycle.state !== 'archived'),
        )
      }
    })
  }, [pathname])

  return (
    <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[200px] shrink-0 flex-col gap-4 overflow-y-auto border-r bg-background px-3 py-4 md:flex lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-[240px]">
      <ul className="flex flex-col gap-0.5">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-[15px] hover:bg-muted',
                pathname === href
                  ? 'bg-muted font-medium'
                  : 'text-muted-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>

      <div>
        <div className="flex items-center justify-between px-3 pb-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            我的圈子
          </span>
          <Link
            href="/circles/new"
            aria-label="点一堆新火"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden />
          </Link>
        </div>
        <ul className="flex flex-col gap-0.5">
          {circles.slice(0, 12).map((circle) => {
            const active = pathname === `/c/${circle.id}`
            return (
              <li key={circle.id}>
                <Link
                  href={`/c/${circle.id}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted',
                    active ? 'bg-muted font-medium' : 'text-foreground/80',
                  )}
                >
                  <Avatar seed={circle.id} size={20} className="rounded" />
                  <span className="truncate">{circle.name}</span>
                  {circle.lifecycle.state === 'hibernating' && (
                    <span
                      className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500"
                      title="快熄了"
                    />
                  )}
                </Link>
              </li>
            )
          })}
          {circles.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">
              还没有加入圈子
            </li>
          )}
        </ul>
      </div>
    </nav>
  )
}
