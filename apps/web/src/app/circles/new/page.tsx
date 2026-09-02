'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Panel } from '@/components/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorText } from '@/lib/api'
import { useRequireSession } from '@/lib/hooks'

interface ParentOption {
  id: string
  name: string
  isOfficial: boolean
}

export default function NewCirclePage() {
  const { session, pending } = useRequireSession()
  const router = useRouter()
  const [parents, setParents] = useState<ParentOption[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session) return
    void api.circles.mine.$get().then(async (res) => {
      if (!res.ok) return
      const { circles } = await res.json()
      setParents(
        circles
          .filter(
            (c) =>
              !c.isDm &&
              c.lifecycle.state !== 'archived' &&
              (c.depth ?? 1) < 3,
          )
          .map((c) => ({ id: c.id, name: c.name, isOfficial: c.isOfficial })),
      )
    })
  }, [session])

  if (pending || !session) return null

  function toggleParent(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 4
          ? [...prev, id]
          : prev,
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <Panel>
        <form
          className="flex flex-col gap-6"
          onSubmit={async (e) => {
            e.preventDefault()
            const name = String(new FormData(e.currentTarget).get('name')).trim()
            if (selected.length === 0) {
              setError('至少挂到一个圈子下面')
              return
            }
            setBusy(true)
            setError('')
            const res = await api.circles.$post({
              json: { name, visibility, parentIds: selected },
            })
            if (!res.ok) {
              setError(await errorText(res))
              setBusy(false)
              return
            }
            const { circle } = await res.json()
            router.replace(`/c/${circle.id}`)
          }}
        >
          <h1 className="text-lg font-semibold">点一堆新火</h1>

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">圈子名字</Label>
            <Input id="name" name="name" maxLength={32} required />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">谁能进来</legend>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
                className="mt-0.5 accent-primary"
              />
              <span>
                公开
                <span className="block text-muted-foreground">
                  上级圈的成员可以看到并加入
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'private'}
                onChange={() => setVisibility('private')}
                className="mt-0.5 accent-primary"
              />
              <span>
                邀请制
                <span className="block text-muted-foreground">
                  凭邀请码加入，外面看不到
                </span>
              </span>
            </label>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">挂在哪个圈子下</legend>
            {parents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                先去加入一个身份圈（比如你的学校）
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {parents.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggleParent(p.id)}
                      className="accent-primary"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={busy || parents.length === 0}>
              {busy ? '点火中…' : '点火'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
