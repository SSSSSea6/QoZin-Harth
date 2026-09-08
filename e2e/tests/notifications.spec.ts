import { expect, test } from '@playwright/test'
import { register } from './helpers'

test('私聊消息进收件箱：顶栏未读数、列表、点击进入会话即已读', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  const a = await register(alice, '阿铃')
  await register(bob, '小铃')

  await bob.goto(`/u/${a.id}`)
  await bob.getByRole('button', { name: '私聊' }).click()
  await bob.waitForURL(/\/c\/[^/]+$/)
  const dmId = bob.url().split('/c/')[1]!
  await bob.getByPlaceholder('说点什么').fill('教材还在吗？')
  await bob.getByRole('button', { name: '发送' }).click()
  await expect(bob.getByText('教材还在吗？')).toBeVisible()

  await alice.goto('/')
  await expect(alice.getByRole('link', { name: '通知，1 条未读' })).toBeVisible()
  await alice.getByRole('link', { name: '通知，1 条未读' }).click()
  await expect(alice.getByRole('heading', { name: '通知' })).toBeVisible()
  const row = alice.getByRole('link', { name: /小铃 发来消息/ })
  await expect(row).toBeVisible()
  await expect(row.getByText('教材还在吗？')).toBeVisible()
  await row.click()
  await alice.waitForURL(`/c/${dmId}`)
  await expect(alice.getByText('教材还在吗？')).toBeVisible()
  await alice.goto('/notifications')
  await expect(alice.getByRole('link', { name: '通知', exact: true })).toBeVisible()
  await expect(alice.getByText('条未读')).toBeHidden()
})
