import { expect, test, type APIRequestContext } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { adminSession, counterBundle, createCircle, joinSchool, register, SCHOOL, uniqueName } from './helpers'

test('工具：发布 → 审核 → 圈主安装 → 成员在圈内使用，数据按圈隔离', async ({ browser }) => {
  const devPage = await (await browser.newContext()).newPage()
  const ownerPage = await (await browser.newContext()).newPage()
  const admin = (await browser.newContext()).request

  await register(devPage, '开发者')
  await register(ownerPage, '圈主')
  await joinSchool(ownerPage)
  const circleName = uniqueName('测试圈')
  const circleId = await createCircle(ownerPage, circleName, SCHOOL)
  const otherName = uniqueName('另一个圈')
  const otherId = await createCircle(ownerPage, otherName, SCHOOL)

  // 开发者用 API 发布（等价于 harth publish）
  const slug = `fixture-${Math.random().toString(36).slice(2, 8)}`
  const published = await devPage.request.post(`${API_URL}/api/tools/publish`, {
    headers: { 'content-type': 'application/zip' },
    data: counterBundle(slug, '计数器'),
  })
  expect(published.status()).toBe(201)
  const { version } = (await published.json()) as { version: { id: string; status: string } }
  expect(version.status).toBe('pending')

  // 管理员审核通过
  await adminSession(admin)
  const reviewed = await admin.post(`${API_URL}/api/tools/versions/${version.id}/review`, {
    data: { decision: 'approve' },
  })
  expect(reviewed.status()).toBe(200)

  // 圈主在市场里看到并安装到一个圈
  await ownerPage.goto('/tools')
  await ownerPage.getByRole('link', { name: /计数器/ }).click()
  await expect(ownerPage.getByRole('heading', { name: '计数器' })).toBeVisible()
  await expect(ownerPage.getByText('在这个圈里保存工具自己的数据')).toBeVisible()
  const row = ownerPage.getByRole('complementary').getByRole('listitem').filter({ hasText: circleName })
  await row.getByRole('button', { name: '安装' }).click()
  await expect(row.getByRole('button', { name: '卸载' })).toBeVisible()

  // 在圈内打开，工具拿到上下文并读写存储
  await ownerPage.goto(`/c/${circleId}`)
  await ownerPage.getByRole('tab', { name: '工具' }).click()
  await ownerPage.getByRole('link', { name: '计数器' }).click()
  const frame = ownerPage.frameLocator('iframe[title="计数器"]')
  await expect(frame.getByText(`圈主 在 ${circleName}`)).toBeVisible()
  await expect(frame.getByText('计数 0')).toBeVisible()
  await frame.getByRole('button', { name: '加一' }).click()
  await expect(frame.getByText('计数 1')).toBeVisible()
  await ownerPage.reload()
  await expect(frame.getByText('计数 1')).toBeVisible()

  // 另一个圈装同一个工具，数据是分开的
  await ownerPage.goto(`/tools/${slug}`)
  const otherRow = ownerPage.getByRole('complementary').getByRole('listitem').filter({ hasText: otherName })
  await otherRow.getByRole('button', { name: '安装' }).click()
  await expect(otherRow.getByRole('button', { name: '卸载' })).toBeVisible()
  await ownerPage.goto(`/c/${otherId}/t/${slug}`)
  await expect(frame.getByText('计数 0')).toBeVisible()

  // 卸载即清空
  await ownerPage.goto(`/c/${circleId}`)
  await ownerPage.getByRole('tab', { name: '工具' }).click()
  ownerPage.once('dialog', (dialog) => void dialog.accept())
  await ownerPage.getByRole('button', { name: '卸载' }).click()
  await expect(ownerPage.getByText('这个圈还没装工具')).toBeVisible()
})

test('命令行登录：设备授权在浏览器里确认后拿到会话', async ({ page, request }) => {
  await register(page, '开发者')

  const code = await request.post(`${API_URL}/api/auth/device/code`, { data: { client_id: 'harth-cli' } })
  expect(code.ok()).toBeTruthy()
  const { device_code, user_code, interval } = (await code.json()) as {
    device_code: string
    user_code: string
    interval: number
  }

  const pending = await pollToken(request, device_code)
  expect(pending.error).toBe('authorization_pending')

  await page.goto(`/device?user_code=${user_code}`)
  await expect(page.getByText('harth-cli')).toBeVisible()
  await page.getByRole('button', { name: '允许' }).click()
  await expect(page.getByText('已允许')).toBeVisible()

  // 轮询间隔由服务端规定，太快会被要求 slow_down
  await page.waitForTimeout((interval + 1) * 1000)
  const granted = await pollToken(request, device_code)
  expect(granted.access_token, JSON.stringify(granted)).toBeTruthy()
  const session = await request.get(`${API_URL}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${granted.access_token}` },
  })
  expect(((await session.json()) as { user: { name: string } }).user.name).toBe('开发者')
})

async function pollToken(request: APIRequestContext, deviceCode: string) {
  const res = await request.post(`${API_URL}/api/auth/device/token`, {
    data: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: 'harth-cli',
    },
  })
  return (await res.json()) as { access_token?: string; error?: string }
}
