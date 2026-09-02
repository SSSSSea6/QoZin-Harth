'use client'

import { Blocks, Home, SquarePen, User, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

export function BottomBar() {
  const { data: session } = useSession()
  const pathname = usePathname()
  if (!session) return null

  const items = [
    { href: '/', label: '首页', icon: Home },
    { href: '/circles', label: '圈子', icon: Users },
    { href: '/posts/new', label: '发帖', icon: SquarePen },
    { href: '/tools', label: '工具', icon: Blocks },
    { href: `/u/${session.user.id}`, label: '我的', icon: User },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
      <ul className="grid h-14 grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-0.5 text-[11px]',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
