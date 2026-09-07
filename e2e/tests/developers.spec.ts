import { expect, test } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { adminSession, counterBundle, register, uniqueName } from './helpers'

test('开发者资格：申请 → 管理员通过 → 拿到邀请码 → 能发布', async ({ browser }) => {
  const devPage = await (await browser.newContext()).newPage()
  const adminPage = await (await browser.newContext()).newPage()

  await register(devPage, '申请者')
  const wish = uniqueName('给班级做值日表')
  await devPage.goto('/developers')
  await expect(devPage.getByRole('heading', { name: '开发者', exact: true })).toBeVisible()
  await devPage.getByLabel('想做什么工具').fill(wish)
  await devPage.getByRole('button', { name: '提交申请' }).click()
  await expect(devPage.getByText('申请已提交')).toBeVisible()

  // 管理员在审核页看到申请并通过
  await adminSession(adminPage.request)
  await adminPage.goto('/tools/review')
  const row = adminPage.getByRole('listitem').filter({ hasText: wish })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '通过' }).click()
  await expect(row).toHaveCount(0)

  // 申请者刷新后看到资格与五个邀请码，随后能发布
  await devPage.reload()
  await expect(devPage.getByText('你已经是开发者')).toBeVisible()
  await expect(devPage.getByRole('button', { name: '复制邀请码' })).toHaveCount(5)
  const slug = `applicant-${Math.random().toString(36).slice(2, 8)}`
  const published = await devPage.request.post(`${API_URL}/api/tools/publish`, {
    headers: { 'content-type': 'application/zip' },
    data: counterBundle(slug, uniqueName('申请者的工具')),
  })
  expect(published.status(), await published.text()).toBe(201)
})
