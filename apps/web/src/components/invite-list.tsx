'use client'

import { formatInviteCode } from '@harth/shared'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/format'

export interface InviteView {
  code: string
  usedBy: string | null
  usedAt: string | null
  expiresAt: string
  revokedAt: string | null
}

function stateOf(invite: InviteView): string {
  if (invite.usedBy) return `${invite.usedBy} 已用`
  if (invite.revokedAt) return '已作废'
  if (new Date(invite.expiresAt) < new Date()) return '已过期'
  return `${timeAgo(invite.expiresAt).replace('后', '')}后过期`
}

export function InviteList({ invites }: { invites: InviteView[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  if (invites.length === 0) return <p className="text-sm text-muted-foreground">没有邀请码。</p>
  return (
    <ul className="flex flex-col">
      {invites.map((invite) => {
        const usable = !invite.usedBy && !invite.revokedAt && new Date(invite.expiresAt) >= new Date()
        return (
          <li key={invite.code} className="flex items-center gap-2 border-b py-2 last:border-b-0">
            <span className={usable ? 'font-mono text-sm' : 'font-mono text-sm text-muted-foreground line-through'}>
              {formatInviteCode(invite.code)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{stateOf(invite)}</span>
            {usable && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="复制邀请码"
                onClick={async () => {
                  await navigator.clipboard.writeText(formatInviteCode(invite.code))
                  setCopied(invite.code)
                  setTimeout(() => setCopied((c) => (c === invite.code ? null : c)), 1500)
                }}
              >
                {copied === invite.code ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
