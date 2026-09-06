'use client'

import { Blocks, ClipboardCheck, Home, Plus, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { api } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
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

const ADMIN_ITEM = { href: '/tools/review', label: '审核', icon: ClipboardCheck }

export function LeftNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [circles, setCircles] = useState<NavCircle[]>([])
  const items = session?.user.isAdmin ? [...ITEMS, ADMIN_ITEM] : ITEMS
  // 最长的前缀才算当前项：/tools/review 只点亮「审核」
  const current = items
    .filter((item) => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

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
    <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[200px] shrink-0 flex-col gap-6 overflow-y-auto border-r bg-background px-3 py-4 md:flex lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-[240px]">
      <ul className="flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === current
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'flex h-12 items-center gap-3 rounded-md px-3 text-base transition-colors hover:bg-hover',
                  active ? 'bg-selected font-semibold text-foreground' : 'text-foreground-2',
                )}
              >
                <Icon className={cn('size-5', active && 'text-brand')} aria-hidden />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>

      <div>
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs font-medium text-muted-foreground">我的圈子</span>
          <Link
            href="/circles/new"
            aria-label="点一堆新火"
            className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden />
          </Link>
        </div>
        <ul className="flex flex-col gap-0.5">
          {circles.slice(0, 12).map((circle) => {
            const active = pathname.startsWith(`/c/${circle.id}`)
            return (
              <li key={circle.id}>
                <Link
                  href={`/c/${circle.id}`}
                  className={cn(
                    'flex h-10 items-center gap-2.5 rounded-md px-3 text-sm transition-colors hover:bg-hover',
                    active ? 'bg-selected font-semibold text-foreground' : 'text-foreground-2',
                  )}
                >
                  <Avatar seed={circle.id} name={circle.name} size={24} shape="square" />
                  <span className="truncate">{circle.name}</span>
                  {circle.lifecycle.state === 'hibernating' && (
                    <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" title="快熄了" />
                  )}
                </Link>
              </li>
            )
          })}
          {circles.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">还没有加入圈子</li>
          )}
        </ul>
      </div>
    </nav>
  )
}
