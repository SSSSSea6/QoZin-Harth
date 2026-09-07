'use client'

import {
  APPLICATION_MESSAGE_MAX,
  formatFuel,
  formatInviteCode,
  FUEL_ALLOWANCE,
  FUEL_RATES,
  FUEL_RUN_RESERVE,
  FUEL_UNIT,
  TOOL_BACKEND_MAX_BYTES,
  TOOL_PACKAGE_MAX_BYTES,
  TOOL_RUN_LIMITS,
  TOOL_STORAGE_MAX_KEYS,
  TOOL_STORAGE_VALUE_MAX_BYTES,
} from '@harth/shared'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Columns } from '@/components/columns'
import { FuelMeter } from '@/components/fuel-meter'
import { InviteList, type InviteView } from '@/components/invite-list'
import { Panel, PanelHeader, PanelTitle } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { timeAgo } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

interface Me {
  status: 'none' | 'active' | 'revoked'
  developer: { grantedAt: string; revokedAt: string | null; revokeReason: string | null } | null
  application: {
    id: string
    status: 'pending' | 'approved' | 'rejected'
    message: string
    note: string | null
    createdAt: string
  } | null
  invites: InviteView[]
  usage: { month: string; used: number; reserved: number; allowance: number; storageBytes: number }
}

const fuel = (units: number) => units / FUEL_UNIT

const RATES = [
  ['后端运行一次', `${fuel(FUEL_RATES.run)}，另按时长每 100 ms ${fuel(FUEL_RATES.runPerMs * 100)}，单次最多 ${fuel(FUEL_RUN_RESERVE)}`],
  ['以工具名义发一条帖', `${fuel(FUEL_RATES.post)}`],
  ['写入存储一次', `${fuel(FUEL_RATES.storageWrite)}，另按大小每 4 KB ${fuel(FUEL_RATES.storageWritePerKiB * 4)}`],
  ['存储占用（含已发布的包）', `每 MB 每天 ${fuel(FUEL_RATES.holdingPerMiBDay)}`],
  ['读取、删除', '0'],
] as const

const LIMITS = [
  `包 ${TOOL_PACKAGE_MAX_BYTES / 1024 / 1024} MB，后端文件 ${TOOL_BACKEND_MAX_BYTES / 1024} KB`,
  `存储每个工具每个圈 ${TOOL_STORAGE_MAX_KEYS} 个键，单个值 ${TOOL_STORAGE_VALUE_MAX_BYTES / 1024} KB`,
  `单次运行脚本 ${TOOL_RUN_LIMITS.scriptMs / 1000} 秒、总时长 ${TOOL_RUN_LIMITS.totalMs / 1000} 秒、内存 ${TOOL_RUN_LIMITS.memoryBytes / 1024 / 1024} MB、宿主调用 ${TOOL_RUN_LIMITS.hostCalls} 次、发帖 ${TOOL_RUN_LIMITS.posts} 条`,
  `定时运行每小时 ${TOOL_RUN_LIMITS.scheduledRunsPerHour} 次`,
]

export default function DevelopersPage() {
  const { data: session, isPending } = useSession()
  return (
    <Columns aside={<StatusPanel loggedIn={Boolean(session)} pending={isPending} />}>
      <Panel padded={false}>
        <PanelHeader title="开发者" />
        <div className="flex flex-col gap-7 px-4 py-5 md:px-6">
          <section>
            <h2 className="text-base font-semibold">把工具放进圈子里</h2>
            <p className="mt-2 text-[15px] leading-6 text-foreground-2">
              工具是一个静态页面，可以带一个后端文件。传上来就能在圈子里跑，不用自己配服务器、容器、域名、证书和数据库。圈主把它装进自己的圈子，用它的人就是那个圈子里的成员，他们可以在工具页里直接给你发消息。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">怎么开始</h2>
            <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-6 text-foreground-2">
              <li>
                在自己的圈里试跑不需要资格：<code>npm i -g harth</code>，然后 <code>harth login</code>、<code>harth init</code>、<code>harth dev</code>。
              </li>
              <li>拿到开发者资格：有邀请码就兑换，没有就写一句想做什么工具来申请。资格只管发布。</li>
              <li>
                <code>harth publish</code> 上传。先自动检查文件、外部资源、后端与时间表，再由 AI 审核代码与权限，通过即上架，圈主可安装。
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-base font-semibold">免费额度</h2>
            <p className="mt-2 text-[15px] leading-6 text-foreground-2">
              用量按「燃料」计，按实际占用的资源折算，每个自然月一算，不结转。有资格的开发者每月 {formatFuel(FUEL_ALLOWANCE.developer)}{' '}
              燃料；还没有资格的账号在自己圈里调试，每月 {formatFuel(FUEL_ALLOWANCE.basic)}。你名下所有工具、所有圈的用量合在一起算。
            </p>
            <table className="mt-3 w-full text-[15px]">
              <tbody>
                {RATES.map(([item, rate]) => (
                  <tr key={item} className="border-t">
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      {item}
                    </th>
                    <td className="py-2 text-foreground-2">{rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[15px] leading-6 text-foreground-2">
              用完后到下个月恢复，期间后端运行和写入会停下，工具页面和读取照常。现在没有付费档。
            </p>
            <ul className="mt-3 flex flex-col gap-1 text-[13px] leading-5 text-muted-foreground">
              {LIMITS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>
      </Panel>
    </Columns>
  )
}

function StatusPanel({ loggedIn, pending }: { loggedIn: boolean; pending: boolean }) {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!loggedIn) return
    const res = await api.developers.me.$get()
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setMe((await res.json()) as Me)
  }, [loggedIn])

  useLoad(load)

  if (pending) return null
  if (!loggedIn) {
    return (
      <Panel>
        <PanelTitle>申请或兑换</PanelTitle>
        <p className="text-sm leading-6 text-foreground-2">登录后可以申请开发者资格，或者兑换邀请码。</p>
        <Button className="mt-3 w-full" nativeButton={false} render={<Link href="/" />}>
          去登录
        </Button>
      </Panel>
    )
  }
  if (error) {
    return (
      <Panel>
        <p className="text-sm text-destructive">{error}</p>
      </Panel>
    )
  }
  if (!me) return null

  return (
    <>
      <Panel>
        <PanelTitle>本月燃料</PanelTitle>
        <FuelMeter usage={me.usage} />
      </Panel>
      {me.status === 'active' && <ActivePanel me={me} />}
      {me.status === 'revoked' && (
        <Panel>
          <PanelTitle>开发者资格</PanelTitle>
          <p className="text-sm leading-6 text-foreground-2">
            资格已被撤销{me.developer?.revokeReason ? `：${me.developer.revokeReason}` : ''}。已装进圈子的工具照常运行，恢复资格需要联系管理员。
          </p>
        </Panel>
      )}
      {me.status === 'none' && <ApplyPanel me={me} onChanged={load} />}
    </>
  )
}

function ActivePanel({ me }: { me: Me }) {
  return (
    <>
      <Panel>
        <PanelTitle>开发者资格</PanelTitle>
        <p className="text-sm leading-6 text-foreground-2">
          你已经是开发者{me.developer ? `，${timeAgo(me.developer.grantedAt)}获得资格` : ''}。
        </p>
        <Button variant="outline" size="sm" className="mt-3" nativeButton={false} render={<Link href="/tools/mine" />}>
          我发布的工具
        </Button>
      </Panel>
      <Panel>
        <PanelTitle>邀请码</PanelTitle>
        <p className="mb-3 text-[13px] leading-5 text-muted-foreground">一码一人，30 天内有效。发给你觉得会来做工具的人。</p>
        <InviteList invites={me.invites} />
      </Panel>
    </>
  )
}

function ApplyPanel({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'redeem' | 'apply' | null>(null)
  const [granted, setGranted] = useState<string[] | null>(null)
  const pendingApplication = me.application?.status === 'pending' ? me.application : null

  async function redeem() {
    setBusy('redeem')
    setError('')
    const res = await api.developers.redeem.$post({ json: { code } })
    setBusy(null)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setGranted((await res.json()).codes)
    onChanged()
  }

  async function apply() {
    setBusy('apply')
    setError('')
    const res = await api.developers.apply.$post({ json: { message } })
    setBusy(null)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    setMessage('')
    onChanged()
  }

  if (granted) {
    return (
      <Panel>
        <PanelTitle>已获得资格</PanelTitle>
        <p className="mb-3 text-sm leading-6 text-foreground-2">这是你的 {granted.length} 个邀请码，可以转发给别人。</p>
        <ul className="flex flex-col gap-1 font-mono text-sm">
          {granted.map((c) => (
            <li key={c}>{formatInviteCode(c)}</li>
          ))}
        </ul>
      </Panel>
    )
  }

  return (
    <>
      <Panel>
        <PanelTitle>有邀请码？</PanelTitle>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void redeem()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-code">邀请码</Label>
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              className="font-mono uppercase"
              required
            />
          </div>
          {error && busy === null && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy !== null || code.trim().length < 10}>
            {busy === 'redeem' ? '兑换中…' : '兑换'}
          </Button>
        </form>
      </Panel>

      <Panel>
        <PanelTitle>申请资格</PanelTitle>
        {pendingApplication ? (
          <p className="text-sm leading-6 text-foreground-2">
            申请已提交（{timeAgo(pendingApplication.createdAt)}），等管理员处理。处理结果会显示在这里。
          </p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void apply()
            }}
          >
            {me.application?.status === 'rejected' && (
              <p className="text-sm leading-6 text-foreground-2">
                上次申请没有通过{me.application.note ? `：${me.application.note}` : ''}。可以再申请。
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-message">想做什么工具</Label>
              <Textarea
                id="apply-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={APPLICATION_MESSAGE_MAX}
                placeholder="给谁用、解决什么问题，一两句就行"
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={busy !== null || !message.trim()}>
              {busy === 'apply' ? '提交中…' : '提交申请'}
            </Button>
          </form>
        )}
      </Panel>
    </>
  )
}
