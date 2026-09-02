'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Panel } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { useRequireSession } from '@/lib/hooks'

interface CircleOption {
  id: string
  name: string
}

type TemplateChoice = 'discussion' | 'secondhand'

export default function NewPostRoute() {
  return (
    <Suspense>
      <NewPostPage />
    </Suspense>
  )
}

function NewPostPage() {
  const { session, pending } = useRequireSession()
  const router = useRouter()
  const params = useSearchParams()
  const presetCircle = params.get('circle') ?? ''
  const presetTemplate =
    params.get('template') === 'secondhand' ? 'secondhand' : 'discussion'

  const [circles, setCircles] = useState<CircleOption[] | null>(null)
  const [circleId, setCircleId] = useState(presetCircle)
  const [enabled, setEnabled] = useState<string[] | null>(null)
  const [template, setTemplate] = useState<TemplateChoice>(presetTemplate)
  const [free, setFree] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session) return
    void api.circles.mine.$get().then(async (res) => {
      if (!res.ok) return
      const list = (await res.json()).circles
        .filter((c) => !c.isDm && c.lifecycle.state !== 'archived')
        .map((c) => ({ id: c.id, name: c.name }))
      setCircles(list)
      if (!presetCircle && list[0]) setCircleId(list[0].id)
    })
  }, [session, presetCircle])

  useEffect(() => {
    if (!circleId) return
    void api.circles[':id']
      .$get({ param: { id: circleId }, query: {} })
      .then(async (res) => {
      if (res.ok) setEnabled((await res.json()).circle.templates)
    })
  }, [circleId])

  // 所选圈子未启用二手时回落到讨论帖
  const activeTemplate: TemplateChoice =
    template === 'secondhand' && enabled && !enabled.includes('secondhand')
      ? 'discussion'
      : template

  if (pending || !session) return null

  return (
    <div className="mx-auto w-full max-w-xl">
      <Panel>
        <form
          className="flex flex-col gap-5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!circleId) return
            const data = new FormData(e.currentTarget)
            const fields =
              activeTemplate === 'discussion'
                ? {
                    title: String(data.get('title')).trim(),
                    body: String(data.get('body') ?? '').trim(),
                  }
                : {
                    title: String(data.get('title')).trim(),
                    description: String(data.get('description') ?? '').trim(),
                    priceFen: free
                      ? 0
                      : Math.round(Number(data.get('price') || 0) * 100),
                  }
            setBusy(true)
            setError('')
            const res = await api.posts.circles[':circleId'].$post({
              param: { circleId },
              json: { templateKey: activeTemplate, fields },
            })
            if (!res.ok) {
              setError(await errorText(res))
              setBusy(false)
              return
            }
            const { post } = await res.json()
            router.replace(`/p/${post.id}`)
          }}
        >
          <h1 className="text-lg font-semibold">发帖</h1>

          <div className="flex flex-col gap-2">
            <Label htmlFor="circle">发到哪个圈</Label>
            {circles === null ? (
              <p className="text-sm text-muted-foreground">加载中…</p>
            ) : circles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                你还没有加入任何圈子。
              </p>
            ) : (
              <select
                id="circle"
                value={circleId}
                onChange={(e) => setCircleId(e.target.value)}
                className="h-9 rounded-lg border bg-background px-3 text-sm"
              >
                {circles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Tabs
            value={activeTemplate}
            onValueChange={(v) => setTemplate(v as TemplateChoice)}
          >
            <TabsList variant="line" className="h-9 justify-start gap-5">
              <TabsTrigger value="discussion" className="flex-none px-0.5">
                讨论
              </TabsTrigger>
              {enabled?.includes('secondhand') && (
                <TabsTrigger value="secondhand" className="flex-none px-0.5">
                  二手
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>

          {activeTemplate === 'discussion' ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">标题</Label>
                <Input id="title" name="title" maxLength={60} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="body">正文</Label>
                <Textarea
                  id="body"
                  name="body"
                  rows={8}
                  maxLength={5000}
                  placeholder="想说什么就写什么（选填）"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">是什么</Label>
                <Input
                  id="title"
                  name="title"
                  maxLength={60}
                  placeholder="例：高等数学（下）教材"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="description">补充说明</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={4}
                  maxLength={2000}
                  placeholder="成色、交接时间地点等（选填）"
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">价格</legend>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      checked={free}
                      onChange={() => setFree(true)}
                      className="accent-primary"
                    />
                    免费赠送
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      checked={!free}
                      onChange={() => setFree(false)}
                      className="accent-primary"
                    />
                    收点费用
                  </label>
                </div>
                {!free && (
                  <div className="flex items-center gap-2">
                    <Input
                      name="price"
                      type="number"
                      min={0.01}
                      step={0.01}
                      max={100000}
                      className="w-32"
                      required
                    />
                    <span className="text-sm text-muted-foreground">元</span>
                  </div>
                )}
              </fieldset>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !circleId}>
              {busy ? '发布中…' : '发布'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              取消
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
