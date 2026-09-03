import { expect, test } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { createCircle, joinSchool, register, SCHOOL, uniqueName } from './helpers'

test('个人页可以导出数据；注销要验证密码，之后无法登录', async ({ page }) => {
  const me = await register(page, '要走的人')
  await joinSchool(page)
  await createCircle(page, uniqueName('临时圈'), SCHOOL)

  await page.goto(`/u/${me.id}`)
  const exportLink = page.getByRole('complementary').getByRole('button', { name: '导出我的数据' })
  await expect(exportLink).toHaveAttribute('href', /\/api\/users\/me\/export$/)
  const exported = await page.request.get(`${API_URL}/api/users/me/export`)
  expect(exported.headers()['content-disposition']).toContain('attachment')
  const data = (await exported.json()) as { user: { name: string }; circles: unknown[] }
  expect(data.user.name).toBe('要走的人')
  expect(data.circles.length).toBeGreaterThan(0)

  await page.getByRole('complementary').getByRole('button', { name: '注销账号' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('输入密码确认').fill('wrong-password')
  await dialog.getByRole('button', { name: '确认注销' }).click()
  await expect(dialog.getByText('密码不对')).toBeVisible()

  await dialog.getByLabel('输入密码确认').fill('e2e-password')
  await dialog.getByRole('button', { name: '确认注销' }).click()
  await expect(page.getByRole('tab', { name: '登录' })).toBeVisible()

  const login = page.getByRole('tabpanel', { name: '登录' })
  await login.getByLabel('邮箱').fill(me.email)
  await login.getByLabel('密码').fill('e2e-password')
  await login.getByRole('button', { name: '登录' }).click()
  await expect(login.locator('p.text-destructive')).toBeVisible()
})
