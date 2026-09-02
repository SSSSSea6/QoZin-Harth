import { expect, test } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { createCircle, joinSchool, register, SCHOOL, uniqueName } from './helpers'

test('嵌套三层与作用域可见性', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  await register(alice, '阿岚')
  await joinSchool(alice)
  await register(bob, '小北')
  await joinSchool(bob)

  const club = uniqueName('航模社')
  const clubId = await createCircle(alice, club, SCHOOL)
  await expect(alice.getByText('社群圈')).toBeVisible()
  await expect(alice.getByRole('tab', { name: '子圈' })).toBeVisible()

  const team = uniqueName('校赛小队')
  const teamId = await createCircle(alice, team, club)
  await expect(alice.getByText('行动圈')).toBeVisible()
  await expect(alice.getByRole('tab', { name: '子圈' })).toHaveCount(0)

  // 第四层：建圈页不提供行动圈作父圈，接口也拒绝
  await alice.goto('/circles/new')
  await expect(alice.getByLabel(club, { exact: true })).toBeVisible()
  await expect(alice.getByLabel(team, { exact: true })).toHaveCount(0)
  const fourth = await alice.request.post(`${API_URL}/api/circles`, {
    data: { name: '第四层', visibility: 'public', parentIds: [teamId] },
  })
  expect(fourth.status()).toBe(400)
  expect(((await fourth.json()) as { error: string }).error).toContain('最多 3 层')

  // B 不在社群圈里，看不到它的子圈，也不能在下面建圈
  await bob.goto(`/c/${teamId}`)
  await expect(bob.getByText('圈子不存在，或你还看不到它')).toBeVisible()
  const denied = await bob.request.post(`${API_URL}/api/circles`, {
    data: { name: '偷建', visibility: 'public', parentIds: [clubId] },
  })
  expect(denied.status()).toBe(403)

  // B 加入社群圈后才看得到行动圈
  await bob.goto('/c/nuaa')
  await bob.getByRole('tab', { name: '子圈' }).click()
  await bob.getByRole('link', { name: club }).click()
  await bob.waitForURL(new RegExp(`/c/${clubId}$`))
  await bob.getByRole('button', { name: '加入圈子' }).click()
  await expect(bob.getByRole('tab', { name: '帖子' })).toBeVisible()
  await bob.goto(`/c/${teamId}`)
  await expect(bob.getByRole('button', { name: '加入圈子' })).toBeVisible()
})
