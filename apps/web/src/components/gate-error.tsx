import Link from 'next/link'
import type { ApiError } from '@/lib/api'
import { useSession } from '@/lib/auth-client'

// 接口错误的统一展示；没绑手机号时顺手给绑定入口
export function GateError({ error, className = 'text-sm text-destructive' }: { error: ApiError | null; className?: string }) {
  const { data: session } = useSession()
  if (!error) return null
  return (
    <p className={className}>
      {error.error}
      {error.code === 'PHONE_REQUIRED' && session && (
        <>
          {' '}
          <Link href={`/u/${session.user.id}`} className="underline underline-offset-2">
            去绑定
          </Link>
        </>
      )}
    </p>
  )
}
