'use client'

import type { ReportTargetType } from '@harth/shared'
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { ReportDialog } from '@/components/report-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { useSession } from '@/lib/auth-client'

// 帖子、回复、消息、个人页右上角的溢出菜单：举报，以及屏蔽作者
export function ItemMenu({
  targetType,
  targetId,
  subjectId,
  onBlocked,
  className,
}: {
  targetType: ReportTargetType
  targetId: string
  subjectId?: string | null
  onBlocked?: () => void
  className?: string
}) {
  const { data: session } = useSession()
  const [reporting, setReporting] = useState(false)
  const [blocked, setBlocked] = useState(false)
  if (!session || subjectId === session.user.id) return null
  const canBlock = Boolean(subjectId) && targetType !== 'tool' && targetType !== 'circle'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" className={className} aria-label="更多操作">
              <MoreHorizontal aria-hidden />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setReporting(true)}>举报</DropdownMenuItem>
          {canBlock && (
            <DropdownMenuItem
              disabled={blocked}
              onClick={async () => {
                const res = await api.users[':id'].block.$put({ param: { id: subjectId! } })
                if (res.ok) {
                  setBlocked(true)
                  onBlocked?.()
                }
              }}
            >
              {blocked ? '已屏蔽' : '屏蔽此人'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {blocked && <span className="text-xs text-muted-foreground">已屏蔽</span>}
      <ReportDialog targetType={targetType} targetId={targetId} open={reporting} onOpenChange={setReporting} />
    </>
  )
}
