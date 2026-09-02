import { expect, test } from '@playwright/test'
import { archiveCircle, daysAgo, register, setCircleTimes, sweep } from './helpers'

test('双人圈是一段会话，沉寂后同样倒计时、添柴、散场', async ({ browser, request }) => {
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  const a = await register(alice, '阿岚')
  await register(bob, '小北')

  // B 从 A 的个人页发起私聊
  await bob.goto(`/u/${a.id}`)
  await bob.getByRole('button', { name: '私聊' }).click()
  await bob.waitForURL(/\/c\/[^/]+$/)
  const dmId = bob.url().split('/c/')[1]!
  await expect(bob.getByText('私聊 · 2 天没动静会自动散场')).toBeVisible()
  await expect(bob.getByText('打个招呼吧')).toBeVisible()
  await bob.getByPlaceholder('说点什么').fill('你好，教材还在吗？')
  await bob.getByRole('button', { name: '发送' }).click()
  await expect(bob.getByText('你好，教材还在吗？')).toBeVisible()

  // A 看到消息，圈子列表里归在私聊
  await alice.goto(`/c/${dmId}`)
  await expect(alice.getByText('你好，教材还在吗？')).toBeVisible()
  await expect(alice.getByRole('link', { name: '小北' })).toBeVisible()
  await alice.goto('/circles')
  await expect(alice.getByRole('heading', { name: '私聊' })).toBeVisible()
  await expect(alice.getByRole('link', { name: '小北' })).toBeVisible()

  // 沉寂后添柴
  await setCircleTimes(request, dmId, { lastActivityAt: daysAgo(3) })
  expect((await sweep(request)).hibernated).toBeGreaterThan(0)
  await alice.goto(`/c/${dmId}`)
  await alice.getByRole('button', { name: '添柴' }).click()
  await expect(alice.getByRole('button', { name: '添柴' })).toHaveCount(0)

  // 到期归档，只读
  await archiveCircle(request, dmId)
  await alice.reload()
  await expect(alice.getByText('这段对话已经安静散场，只读')).toBeVisible()
  await expect(alice.getByRole('button', { name: '发送' })).toHaveCount(0)
})
