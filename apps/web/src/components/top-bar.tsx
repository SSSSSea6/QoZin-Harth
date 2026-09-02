'use client'

import { Flame, LogOut, SquarePen } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Avatar } from '@/components/avatar'
import { Button } from '@/components/ui/button'
import { signOut, useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/', label: '首页' },
  { href: '/circles', label: '圈子' },
  { href: '/tools', label: '工具' },
]

export function TopBar() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-6 px-3">
        <Link href="/" className="flex items-center gap-1.5 text-[17px] font-semibold">
          <Flame className="size-5 text-primary" aria-hidden />
          火塘
        </Link>

        {session && (
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[15px] hover:bg-muted',
                  pathname === item.href
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          {session ? (
            <>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href="/posts/new" />}
                className="hidden md:inline-flex"
              >
                <SquarePen aria-hidden /> 发帖
              </Button>
              <Link
                href={`/u/${session.user.id}`}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
              >
                <Avatar seed={session.user.id} size={28} />
                <span className="hidden text-sm md:inline">
                  {session.user.name}
                </span>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="退出登录"
                className="text-muted-foreground"
                onClick={async () => {
                  await signOut()
                  router.replace('/')
                }}
              >
                <LogOut aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
