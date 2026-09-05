'use client'

import { TOOL_SCOPES, type ToolScope } from '@harth/shared'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { Avatar } from '@/components/avatar'
import { Columns } from '@/components/columns'
import { Panel, PanelTitle } from '@/components/panel'
import { ToolFrame, type ToolGrant } from '@/components/tool-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { formatBytes, timeAgo } from '@/lib/format'
import { useLoad, useRequireSession } from '@/lib/hooks'
import { VERSION_STATUS, type VersionStatus } from '@/lib/tool-status'

interface Review {
  checks?: { name: string; ok: boolean; detail?: string }[]
  ai?: {
    verdict: 'approve' | 'reject' | 'manual'
    summary: string
    issues: string[]
    usefulness: number
    model: string
  }
  admin?: { decision: string; note?: string; at: string }
  error?: string
}

interface Version {
  id: string
  version: string
  status: VersionStatus
  review: Review | null
  createdAt: string
  reviewedAt: string | null
}

interface Detail {
  tool: { slug: string; name: string }
  version: Version
  manifest: {
    description: string
    entry: string
    permissions: ToolScope[]
    actions: { name: string; description: string }[]
  }
  developer: { id: string; name: string }
  isCurrent: boolean
}

interface PackageFile {
  name: string
  size: number
  text?: string
}

interface RunCircle {
  id: string
  name: string
}

const AI_VERDICT = { approve: '建议通过', reject: '建议拒绝', manual: '拿不准' } as const

export default function ReviewDetailPage() {
  const { session, pending } = useRequireSession()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [files, setFiles] = useState<{ files: PackageFile[]; truncated: boolean } | null>(null)
  const [circles, setCircles] = useState<RunCircle[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    const [detailRes, filesRes, circlesRes] = await Promise.all([
      api.tools.versions[':id'].$get({ param: { id } }),
      api.tools.versions[':id'].files.$get({ param: { id } }),
      api.circles.mine.$get(),
    ])
    if (!detailRes.ok) {
      setError(await errorText(detailRes))
      return
    }
    setDetail((await detailRes.json()) as Detail)
    if (filesRes.ok) setFiles(await filesRes.json())
    if (circlesRes.ok) {
      const { circles: mine } = await circlesRes.json()
      setCircles(mine.filter((c) => !c.isDm && c.lifecycle.state !== 'archived'))
    }
  }, [session, id])

  useLoad(load)

  if (pending || !session) return null
  if (error) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
      </Panel>
    )
  }
  if (!detail) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </Panel>
    )
  }

  const { version, manifest } = detail
  const review = version.review
  const admin = session.user.isAdmin
  const status = VERSION_STATUS[version.status]

  async function rerun() {
    setBusy(true)
    const res = await api.tools.versions[':id'].rereview.$post({ param: { id } })
    setBusy(false)
    if (!res.ok) setError(await errorText(res))
    else void load()
  }

  return (
    <Columns>
      <div className="text-sm">
        <Link href="/tools/review" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          审核
        </Link>
      </div>

      <Panel>
        <div className="flex gap-4">
          <Avatar seed={`tool:${detail.tool.slug}`} size={56} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{detail.tool.name}</h1>
              <span className="font-mono text-xs text-muted-foreground">v{version.version}</span>
              <Badge variant={status.variant} className="rounded-sm">
                {status.label}
              </Badge>
              {detail.isCurrent && <span className="text-xs text-muted-foreground">当前上架版本</span>}
            </div>
            <p className="mt-1 text-[15px] leading-7">{manifest.description}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {detail.tool.slug} ·{' '}
              <Link href={`/u/${detail.developer.id}`} className="hover:underline">
                {detail.developer.name}
              </Link>{' '}
              · {timeAgo(version.createdAt)} 提交
              {version.reviewedAt ? ` · ${timeAgo(version.reviewedAt)} 处理` : ''}
            </p>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelTitle>清单</PanelTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">入口</dt>
          <dd className="font-mono text-[13px]">{manifest.entry}</dd>
          <dt className="text-muted-foreground">权限</dt>
          <dd>
            {manifest.permissions.length === 0 ? (
              '无'
            ) : (
              <ul className="flex flex-col gap-0.5">
                {manifest.permissions.map((scope) => (
                  <li key={scope}>
                    {TOOL_SCOPES[scope]}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{scope}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
          {manifest.actions.length > 0 && (
            <>
              <dt className="text-muted-foreground">动作</dt>
              <dd>
                <ul className="flex flex-col gap-0.5">
                  {manifest.actions.map((action) => (
                    <li key={action.name}>
                      <span className="font-mono text-[13px]">{action.name}</span> {action.description}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </Panel>

      <Panel>
        <PanelTitle>自动检查</PanelTitle>
        <ul className="flex flex-col gap-1 text-sm">
          {(review?.checks ?? []).map((check) => (
            <li key={check.name} className="flex gap-2">
              <span className={check.ok ? 'text-muted-foreground' : 'text-destructive'}>
                {check.ok ? '通过' : '未通过'}
              </span>
              <span>
                {check.name}
                {check.detail ? `：${check.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelTitle
          action={
            admin && review?.error && version.status === 'pending' ? (
              <Button size="sm" variant="outline" onClick={rerun} disabled={busy}>
                重新审核
              </Button>
            ) : undefined
          }
        >
          AI 审核
        </PanelTitle>
        {review?.ai ? (
          <div className="flex flex-col gap-1.5 text-sm">
            <p>
              <span className="font-medium">{AI_VERDICT[review.ai.verdict]}</span>
              <span className="ml-2 text-muted-foreground">
                实用性 {review.ai.usefulness}/5 · {review.ai.model}
              </span>
            </p>
            <p>{review.ai.summary}</p>
            {review.ai.issues.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {review.ai.issues.map((issue, i) => (
                  <li key={i}>· {issue}</li>
                ))}
              </ul>
            )}
          </div>
        ) : review?.error ? (
          <p className="text-sm text-muted-foreground">没跑完：{review.error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {version.status === 'pending' ? '还没有结果。' : '没有 AI 结果。'}
          </p>
        )}
      </Panel>

      <Panel>
        <PanelTitle>文件</PanelTitle>
        {files === null ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            {files.truncated && (
              <p className="mb-2 text-xs text-muted-foreground">文本太多，只显示了前 300 KB。</p>
            )}
            <ul className="flex flex-col gap-1">
              {files.files.map((file) => (
                <li key={file.name}>
                  <details className="rounded-md border">
                    <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="font-mono text-[13px]">{file.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                    </summary>
                    {file.text !== undefined ? (
                      <pre className="max-h-[480px] overflow-auto border-t px-3 py-2 text-xs leading-5">
                        {file.text}
                      </pre>
                    ) : (
                      <p className="border-t px-3 py-2 text-xs text-muted-foreground">二进制文件，不显示内容。</p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {admin && <RunPanel versionId={id} circles={circles} />}

      {admin && <DecisionPanel version={version} onDone={() => router.push('/tools/review')} />}
    </Columns>
  )
}

function RunPanel({ versionId, circles }: { versionId: string; circles: RunCircle[] }) {
  const [grant, setGrant] = useState<ToolGrant | null>(null)
  const [circleId, setCircleId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const mintFor = useCallback(
    async (cid: string) => {
      const res = await api.tools.versions[':id'].preview.$post({
        param: { id: versionId },
        json: { circleId: cid },
      })
      if (!res.ok) {
        setError(await errorText(res))
        return null
      }
      const next = (await res.json()) as ToolGrant
      setGrant(next)
      return next
    },
    [versionId],
  )

  const mint = useCallback(
    () => (circleId ? mintFor(circleId) : Promise.resolve(null)),
    [circleId, mintFor],
  )

  async function run(circle: RunCircle) {
    setBusy(true)
    setError('')
    setGrant(null)
    setCircleId(circle.id)
    await mintFor(circle.id)
    setBusy(false)
  }

  function stop() {
    setGrant(null)
    setCircleId(null)
  }

  return (
    <>
      <Panel>
        <PanelTitle>试运行</PanelTitle>
        {circles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            工具要在圈里运行，你还没有加入圈子，先
            <Link href="/circles" className="underline">
              加入一个
            </Link>
            。
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              以你的身份在所选的圈里真实运行：它保存的数据会留在那个圈，发的帖也是真的。
            </p>
            <ul className="flex flex-col gap-3">
              {circles.map((circle) => {
                const running = grant !== null && circleId === circle.id
                return (
                  <li key={circle.id} className="flex items-center gap-3">
                    <Avatar seed={circle.id} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm">{circle.name}</span>
                    <Button
                      size="sm"
                      variant={running ? 'outline' : 'default'}
                      disabled={busy}
                      onClick={() => (running ? stop() : run(circle))}
                    >
                      {running ? '停止' : '运行'}
                    </Button>
                  </li>
                )
              })}
            </ul>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </>
        )}
      </Panel>
      {grant && (
        <Panel padded={false} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
            <span className="font-medium">{grant.context.tool.name}</span>
            <span className="text-xs text-muted-foreground">在「{grant.context.circle.name}」里运行</span>
          </div>
          <ToolFrame grant={grant} mint={mint} className="h-[560px]" />
        </Panel>
      )}
    </>
  )
}

function DecisionPanel({ version, onDone }: { version: Version; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    setError('')
    const res = await api.tools.versions[':id'].review.$post({
      param: { id: version.id },
      json: { decision, note: note.trim() || undefined },
    })
    setBusy(false)
    if (!res.ok) {
      setError(await errorText(res))
      return
    }
    onDone()
  }

  const hint = {
    pending: '驳回必填，开发者会看到',
    approved: '下架原因，开发者会看到',
    rejected: '可选，开发者会看到',
  }[version.status]
  const canReject = note.trim().length > 0

  return (
    <Panel>
      <PanelTitle>处理</PanelTitle>
      {version.status === 'rejected' && (
        <p className="mb-3 text-sm text-muted-foreground">这个版本已被驳回，可以改判通过。</p>
      )}
      {version.review?.admin?.note && (
        <p className="mb-3 text-sm text-muted-foreground">上次备注：{version.review.admin.note}</p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="review-note">备注</Label>
        <Textarea
          id="review-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder={hint}
        />
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        {version.status !== 'approved' && (
          <Button onClick={() => decide('approve')} disabled={busy}>
            通过
          </Button>
        )}
        {version.status !== 'rejected' && (
          <Button
            variant={version.status === 'approved' ? 'destructive' : 'outline'}
            onClick={() => decide('reject')}
            disabled={busy || !canReject}
          >
            {version.status === 'approved' ? '下架' : '驳回'}
          </Button>
        )}
      </div>
    </Panel>
  )
}
