'use client'

import { LogOut, SquarePen } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/avatar'
import { Button } from '@/components/ui/button'
import { signOut, useSession } from '@/lib/auth-client'

export function TopBar() {
  const { data: session } = useSession()
  const router = useRouter()

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="flex h-14 w-full items-center gap-6 px-3 md:px-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={28} height={28} className="size-7 rounded-md" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wordmark.svg" alt="火塘" className="h-[18px] w-auto" />
        </Link>

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
