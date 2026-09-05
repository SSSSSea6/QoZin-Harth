import { expect, test, type APIRequestContext } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { adminSession, backendBundle, createCircle, joinSchool, register, SCHOOL, uniqueName } from './helpers'

async function publishAndApprove(dev: APIRequestContext, admin: APIRequestContext, bundle: Buffer): Promise<void> {
  const published = await dev.post(`${API_URL}/api/tools/publish`, {
    headers: { 'content-type': 'application/zip' },
    data: bundle,
  })
  expect(published.status(), await published.text()).toBe(201)
  const { version } = (await published.json()) as { version: { id: string; status: string } }
  expect(version.status).toBe('pending')
  const reviewed = await admin.post(`${API_URL}/api/tools/versions/${version.id}/review`, { data: { decision: 'approve' } })
  expect(reviewed.status()).toBe(200)
}

test('后端工具：安装页看到时间表 → 圈内调用后端 → 定时发帖显示为工具 → 运行记录 → 新版本要确认', async ({ browser }) => {
  const devPage = await (await browser.newContext()).newPage()
  const ownerPage = await (await browser.newContext()).newPage()
  const admin = (await browser.newContext()).request

  await register(devPage, '开发者')
  await register(ownerPage, '圈主')
  await joinSchool(ownerPage)
  const circleName = uniqueName('后端圈')
  const circleId = await createCircle(ownerPage, circleName, SCHOOL)

  const slug = `backend-${Math.random().toString(36).slice(2, 8)}`
  const name = uniqueName('值日提醒')
  await adminSession(admin)
  await publishAndApprove(devPage.request, admin, backendBundle(slug, name))

  // 安装页把时间表翻成人话
  await ownerPage.goto(`/tools/${slug}`)
  await expect(ownerPage.getByRole('heading', { name })).toBeVisible()
  await expect(ownerPage.getByText('按清单里的时间表定时运行')).toBeVisible()
  await expect(ownerPage.getByText('每个工作日 08:00 运行 remind')).toBeVisible()
  const row = ownerPage.getByRole('complementary').getByRole('listitem').filter({ hasText: circleName })
  await row.getByRole('button', { name: '安装' }).click()
  await expect(row.getByRole('button', { name: '卸载' })).toBeVisible()

  // 圈内打开，前端调用后端动作
  await ownerPage.goto(`/c/${circleId}`)
  await ownerPage.getByRole('tab', { name: '工具' }).click()
  await expect(ownerPage.getByText('定时：每个工作日 08:00 运行 remind')).toBeVisible()
  await ownerPage.getByRole('link', { name }).first().click()
  const frame = ownerPage.frameLocator(`iframe[title="${name}"]`)
  await expect(frame.getByText('后端计数 1')).toBeVisible()
  await ownerPage.reload()
  await expect(frame.getByText('后端计数 2')).toBeVisible()

  // 到点定时运行：帖子以工具身份出现
  const due = await admin.post(`${API_URL}/api/test/tool-schedules-due`, { data: { circleId, slug } })
  expect(due.ok()).toBeTruthy()
  const tick = await admin.post(`${API_URL}/api/test/tool-tick`, { data: {} })
  expect(((await tick.json()) as { created: number }).created).toBe(1)
  await ownerPage.goto(`/c/${circleId}`)
  const reminder = ownerPage.getByRole('listitem').filter({ hasText: '提醒：今天记得点名' })
  await expect(reminder).toBeVisible({ timeout: 15_000 })
  await expect(reminder.getByText('工具', { exact: true })).toBeVisible()
  await expect(reminder.getByRole('link', { name })).toBeVisible()

  // 圈主看运行记录
  await ownerPage.getByRole('tab', { name: '工具' }).click()
  await ownerPage.getByRole('button', { name: '运行记录' }).click()
  const scheduled = ownerPage
    .getByRole('listitem')
    .filter({ hasText: 'remind' })
    .filter({ hasText: '定时' })
    .filter({ hasNotText: '卸载' })
  await expect(scheduled).toBeVisible()
  await expect(scheduled.getByText('成功')).toBeVisible()

  // 新版本改了时间表，圈主确认前按旧的
  await publishAndApprove(devPage.request, admin, backendBundle(slug, name, '1.0.1', '0 9 * * *'))
  await ownerPage.reload()
  await ownerPage.getByRole('tab', { name: '工具' }).click()
  await expect(ownerPage.getByText('新版本改了权限或时间表')).toBeVisible()
  await expect(ownerPage.getByText('定时：每个工作日 08:00 运行 remind')).toBeVisible()
  await ownerPage.getByRole('button', { name: '确认' }).click()
  await expect(ownerPage.getByText('新版本改了权限或时间表')).toHaveCount(0)
  await expect(ownerPage.getByText('定时：每天 09:00 运行 remind')).toBeVisible()
})
