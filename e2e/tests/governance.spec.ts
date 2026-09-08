import { expect, test } from '@playwright/test'
import { adminSession, joinSchool, register, uniqueName } from './helpers'

test('举报 → 隐藏 → 申诉 → 恢复；屏蔽后互不打扰', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  const admin = await (await browser.newContext()).newPage()
  const a = await register(alice, '阿治')
  await joinSchool(alice)
  await register(bob, '小治')
  await joinSchool(bob)
  await adminSession(admin.request)

  // A 发帖
  const title = uniqueName('治理测试帖')
  await alice.goto('/posts/new?circle=nuaa')
  await alice.getByLabel('标题').fill(title)
  await alice.getByRole('button', { name: '发布', exact: true }).click()
  await alice.waitForURL(/\/p\/[^/]+$/)
  const postUrl = alice.url()

  // B 举报
  await bob.goto(postUrl)
  await bob.getByRole('button', { name: '更多操作' }).first().click()
  await bob.getByRole('menuitem', { name: '举报' }).click()
  const report = bob.getByRole('dialog', { name: '举报帖子' })
  await report.getByLabel('垃圾广告').check()
  await report.getByLabel('补充说明（选填）').fill('全是广告')
  await report.getByRole('button', { name: '提交举报' }).click()
  await expect(report.getByText('已收到')).toBeVisible()
  await report.getByRole('button', { name: '关闭' }).click()

  // 管理员隐藏
  await admin.goto('/tools/review')
  const reports = admin.locator('section', { has: admin.getByRole('heading', { name: '举报' }) })
  const row = reports.locator('li', { hasText: title })
  await expect(row.getByText('全是广告')).toBeVisible()
  await row.getByRole('button', { name: '隐藏' }).click()
  const hide = admin.getByRole('dialog', { name: '隐藏内容' })
  await hide.getByLabel('原因（对方会看到）').fill('广告')
  await hide.getByRole('button', { name: '确认' }).click()
  await expect(row).toBeHidden()

  // 其他人只看到占位，作者看到原因
  await bob.goto(postUrl)
  await expect(bob.getByText('这条内容已被处理，不再展示。')).toBeVisible()
  await alice.goto(postUrl)
  await expect(alice.getByText('这条帖子已被隐藏，其他人看不到：广告')).toBeVisible()

  // 作者申诉
  await alice.goto(`/u/${a.id}`)
  const mine = alice.locator('section', { has: alice.getByRole('heading', { name: '针对我的处置' }) })
  await expect(mine.getByText('原因：广告')).toBeVisible()
  await mine.getByRole('button', { name: '申诉' }).click()
  await alice.getByRole('dialog', { name: '申诉' }).getByLabel('说明').fill('这是圈里的团购信息')
  await alice.getByRole('button', { name: '提交申诉' }).click()
  await expect(mine.getByText('申诉已提交')).toBeVisible()

  // 管理员接受申诉，帖子恢复
  await admin.goto('/tools/review')
  const appeals = admin.locator('section', { has: admin.getByRole('heading', { name: '申诉' }) })
  const appealRow = appeals.locator('li', { hasText: '这是圈里的团购信息' })
  await appealRow.getByRole('button', { name: '接受' }).click()
  const accept = admin.getByRole('dialog', { name: '接受申诉' })
  await accept.getByLabel('原因（对方会看到）').fill('确认是团购')
  await accept.getByRole('button', { name: '确认' }).click()
  await expect(appealRow).toBeHidden()
  await bob.goto(postUrl)
  await expect(bob.getByRole('heading', { name: title })).toBeVisible()

  // B 屏蔽 A：信息流不再出现，A 也不能私聊 B
  await bob.getByRole('button', { name: '更多操作' }).first().click()
  await bob.getByRole('menuitem', { name: '屏蔽此人' }).click()
  await expect(bob.locator('main').getByText('已屏蔽', { exact: true })).toBeVisible()
  await bob.goto('/')
  await expect(bob.getByRole('heading', { name: '首页' })).toBeVisible()
  await expect(bob.getByText(title)).toBeHidden()
  await alice.goto(`/u/${(await bob.locator('header a[href^="/u/"]').getAttribute('href'))!.slice('/u/'.length)}`)
  await alice.getByRole('button', { name: '私聊' }).click()
  await expect(alice.getByText('对方或你已屏蔽')).toBeVisible()
})
