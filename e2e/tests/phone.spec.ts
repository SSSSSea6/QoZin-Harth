import { expect, test } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { joinSchool, register } from './helpers'

test('没绑手机号不能发帖；绑定走真实验证码后可以', async ({ page }) => {
  const me = await register(page, '绑手机', { phone: false })
  await joinSchool(page)

  await page.goto('/posts/new?circle=nuaa')
  await page.getByLabel('标题').fill('还没绑')
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect(page.getByText('发言前先绑定手机号')).toBeVisible()
  await page.getByRole('link', { name: '去绑定' }).click()
  await expect(page).toHaveURL(`/u/${me.id}`)
  await expect(page.getByText('未绑定手机号')).toBeVisible()

  const phone = `139${String(Date.now()).slice(-8)}`
  await page.getByRole('button', { name: '绑定' }).click()
  const dialog = page.getByRole('dialog', { name: '绑定手机号' })
  await dialog.getByLabel('手机号').fill(phone)
  await dialog.getByRole('button', { name: '发验证码' }).click()
  await expect(dialog.getByRole('button', { name: /秒后可重发/ })).toBeVisible()
  const sms = await page.request.get(`${API_URL}/api/test/sms?phone=${encodeURIComponent(`+86${phone}`)}`)
  const { code } = (await sms.json()) as { code: string }
  expect(code).toMatch(/^\d{6}$/)
  await dialog.getByLabel('验证码').fill(code)
  await dialog.getByRole('button', { name: '确认绑定' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`+86 ****${phone.slice(-4)}`)).toBeVisible()

  await page.goto('/posts/new?circle=nuaa')
  await page.getByLabel('标题').fill('绑好了')
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await page.waitForURL(/\/p\/[^/]+$/)
  await expect(page.getByRole('heading', { name: '绑好了' })).toBeVisible()
})
