'use client'

import { useRouter } from 'next/navigation'
import { DeleteAccountDialog } from '@/components/delete-account-dialog'
import { MyModerations } from '@/components/moderation-panels'
import { Panel, PanelTitle } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/api'
import { signOut } from '@/lib/auth-client'

// 被封禁的账号登录后只看到这一页：原因、申诉、导出、注销
export function RestrictedPage({ reason }: { reason: string }) {
  const router = useRouter()
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <Panel>
        <PanelTitle>账号已被封禁</PanelTitle>
        <p className="text-sm text-muted-foreground">原因：{reason}</p>
        <p className="mt-2 text-sm text-muted-foreground">封禁期间不能看圈子和发言。你可以对处置提出申诉，也可以导出数据或注销账号。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={`${API_URL}/api/users/me/export`} download />}>
            导出我的数据
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await signOut()
              router.replace('/')
            }}
          >
            退出登录
          </Button>
          <DeleteAccountDialog />
        </div>
      </Panel>
      <MyModerations title="处置记录与申诉" />
    </div>
  )
}
