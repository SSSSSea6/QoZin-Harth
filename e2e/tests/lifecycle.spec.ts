import { expect, test } from '@playwright/test'
import {
  archiveCircle,
  createCircle,
  daysAgo,
  joinSchool,
  register,
  SCHOOL,
  setCircleTimes,
  sweep,
  uniqueName,
} from './helpers'

test('圈子沉寂后倒计时，添柴续上；无人添柴则归档只读', async ({ page, request }) => {
  await register(page, '阿岚')
  await joinSchool(page)
  const name = uniqueName('晨跑团')
  const circleId = await createCircle(page, name, SCHOOL)
  await expect(
    page.getByRole('navigation').getByRole('link', { name }),
  ).toBeVisible()

  // 沉寂后进入倒计时
  await setCircleTimes(request, circleId, { lastActivityAt: daysAgo(120) })
  expect((await sweep(request)).hibernated).toBeGreaterThan(0)
  await page.goto('/')
  await expect(page.getByText('快熄的火')).toBeVisible()
  await expect(page.getByText(/天后熄灭/)).toBeVisible()
  await page.goto(`/c/${circleId}`)
  await expect(page.getByText('好久没动静了')).toBeVisible()

  // 添柴解除倒计时
  await page.getByRole('button', { name: '添柴' }).click()
  await expect(page.getByText('好久没动静了')).toHaveCount(0)
  await expect(page.getByText('燃着')).toBeVisible()

  // 到期归档：活跃列表消失，仍可只读访问
  await archiveCircle(request, circleId)
  await page.reload()
  await expect(page.getByText('这堆火已经熄了')).toBeVisible()
  await expect(
    page.getByRole('main').getByRole('button', { name: '发帖' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('navigation').getByRole('link', { name }),
  ).toHaveCount(0)
  await page.goto('/circles')
  await expect(page.getByRole('link', { name })).toContainText('已归档')
})
