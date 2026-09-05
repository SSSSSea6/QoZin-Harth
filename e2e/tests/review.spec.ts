import { expect, test, type Page } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { adminSession, counterBundle, register, SCHOOL, uniqueName } from './helpers'

test('审核页：待审 → 试运行 → 驳回 → 通过 → 下架；非管理员进不去', async ({ browser }) => {
  const devPage = await (await browser.newContext()).newPage()
  const adminPage = await (await browser.newContext()).newPage()

  await register(devPage, '开发者')
  const slug = `review-${Math.random().toString(36).slice(2, 8)}`
  const name = uniqueName('审核工具')
  const publishVersion = async (version: string) => {
    const res = await devPage.request.post(`${API_URL}/api/tools/publish`, {
      headers: { 'content-type': 'application/zip' },
      data: counterBundle(slug, name, version),
    })
    expect(res.status()).toBe(201)
  }
  await publishVersion('1.0.0')

  // 管理员登录并加入身份圈，试运行要在圈里进行；重试时可能已经加入
  await adminSession(adminPage.request)
  const top = (await (await adminPage.request.get(`${API_URL}/api/circles/top`)).json()) as {
    circles: { id: string }[]
  }
  await adminPage.request.post(`${API_URL}/api/circles/${top.circles[0]!.id}/join`)

  await adminPage.goto('/tools/review')
  await expect(adminPage.locator('nav').getByRole('link', { name: '审核' })).toBeVisible()
  await openVersion(adminPage, name, '待审')
  await expect(adminPage.getByText('在这个圈里保存工具自己的数据')).toBeVisible()
  await adminPage.locator('summary', { hasText: 'index.html' }).click()
  await expect(adminPage.getByText('harth.connect()')).toBeVisible()

  // 试运行：未安装也能在自己所在的圈里跑起来
  const runPanel = adminPage.locator('section', { has: adminPage.getByRole('heading', { name: '试运行' }) })
  await runPanel.getByRole('button', { name: '运行' }).click()
  const frame = adminPage.frameLocator(`iframe[title="${name}"]`)
  await expect(frame.getByText(`管理员 在 ${SCHOOL}`)).toBeVisible()
  await expect(frame.getByText('计数 0')).toBeVisible()
  await frame.getByRole('button', { name: '加一' }).click()
  await expect(frame.getByText('计数 1')).toBeVisible()

  // 驳回要写原因
  const reject = adminPage.getByRole('button', { name: '驳回' })
  await expect(reject).toBeDisabled()
  await adminPage.getByLabel('备注').fill('先把说明写清楚')
  await reject.click()
  await adminPage.waitForURL(/\/tools\/review$/)
  await expect(versionLink(adminPage, name, '已处理', '未通过')).toBeVisible()

  await devPage.goto('/tools/mine')
  await expect(devPage.getByText('管理员：先把说明写清楚')).toBeVisible()

  // 第二版通过后上架
  await publishVersion('1.0.1')
  await adminPage.goto('/tools/review')
  await openVersion(adminPage, name, '待审')
  await adminPage.getByRole('button', { name: '通过' }).click()
  await adminPage.waitForURL(/\/tools\/review$/)
  await adminPage.goto('/tools')
  await expect(adminPage.getByRole('link', { name })).toBeVisible()

  // 下架后市场里没有了
  await adminPage.goto('/tools/review')
  await openVersion(adminPage, name, '已处理', '已上架')
  await adminPage.getByLabel('备注').fill('有问题，先下架')
  await adminPage.getByRole('button', { name: '下架' }).click()
  await adminPage.waitForURL(/\/tools\/review$/)
  await adminPage.goto('/tools')
  await expect(adminPage.getByRole('link', { name })).toHaveCount(0)

  // 非管理员没有入口，直接访问也被拒
  await devPage.goto('/tools/review')
  await expect(devPage.getByText('只有管理员能审核')).toBeVisible()
  await expect(devPage.locator('nav').getByRole('link', { name: '审核' })).toHaveCount(0)
})

function versionLink(page: Page, name: string, section: string, status?: string) {
  const links = page
    .locator('section', { has: page.getByRole('heading', { name: section }) })
    .getByRole('link', { name: new RegExp(name) })
  return status ? links.filter({ hasText: status }) : links
}

async function openVersion(page: Page, name: string, section: string, status?: string): Promise<void> {
  await versionLink(page, name, section, status).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}
