import { expect, test } from '@playwright/test'
import {
  archiveCircle,
  createCircle,
  expectReputation,
  joinSchool,
  register,
  SCHOOL,
  uniqueName,
} from './helpers'

test('二手闭环走通并落进个人信誉', async ({ browser, request }) => {
  const seller = await (await browser.newContext()).newPage()
  const buyer = await (await browser.newContext()).newPage()

  const a = await register(seller, '阿岚')
  await joinSchool(seller)
  const b = await register(buyer, '小北')
  await joinSchool(buyer)

  const circleId = await createCircle(seller, uniqueName('旧书交换'), SCHOOL)

  // B 加入 A 的圈
  await buyer.goto(`/c/${circleId}`)
  await buyer.getByRole('button', { name: '加入圈子' }).click()
  await expect(buyer.getByRole('tab', { name: '帖子' })).toBeVisible()

  // A 启用二手，发布闲置
  await seller.getByRole('tab', { name: '二手' }).click()
  await seller.getByRole('button', { name: '启用二手' }).click()
  await seller.getByRole('button', { name: '发布闲置' }).click()
  await expect(seller.getByRole('tab', { name: '二手' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await seller.getByLabel('是什么').fill('高等数学（下）教材')
  await seller.getByLabel('补充说明').fill('九成新，笔记不多')
  await seller.getByLabel('收点费用').check()
  await seller.getByRole('spinbutton').fill('20')
  await seller.getByRole('button', { name: '发布', exact: true }).click()
  await seller.waitForURL(/\/p\/[^/]+$/)
  const postId = seller.url().split('/p/')[1]!
  await expect(
    seller.getByRole('heading', { name: '高等数学（下）教材' }),
  ).toBeVisible()
  await expect(seller.getByText('¥20')).toBeVisible()

  // B 应答
  await buyer.goto(`/p/${postId}`)
  await buyer.getByPlaceholder('说一句怎么交接').fill('今晚七点，二食堂门口')
  await buyer.getByRole('button', { name: '应答', exact: true }).click()
  await expect(buyer.getByText('已应答：「今晚七点，二食堂门口」')).toBeVisible()

  // A 选定 B，确认交接
  await seller.reload()
  await expect(seller.getByRole('heading', { name: '应答（1）' })).toBeVisible()
  await expect(seller.getByText('今晚七点，二食堂门口')).toBeVisible()
  await seller.getByRole('button', { name: '选定' }).click()
  await expect(seller.getByText('进行中')).toBeVisible()
  await expect(seller.getByText('已和 小北 约定交接')).toBeVisible()
  await seller.getByRole('button', { name: '确认完成' }).click()
  await expect(seller.getByText('发布者：已确认')).toBeVisible()

  // B 确认成交并评价 A
  await buyer.reload()
  await expect(buyer.getByText('应答者：待确认')).toBeVisible()
  await buyer.getByRole('button', { name: '确认完成' }).click()
  await expect(buyer.getByText('交接完成')).toBeVisible()
  await expect(buyer.getByText('已完成')).toBeVisible()
  await buyer.getByRole('radio', { name: '4 分' }).click()
  await buyer.getByPlaceholder('一句话就好').fill('书很新')
  await buyer.getByRole('button', { name: '提交评价' }).click()
  await expect(buyer.getByText('你已评价过对方')).toBeVisible()

  // A 评价 B
  await seller.reload()
  await expect(seller.getByText('交接完成')).toBeVisible()
  await seller.getByPlaceholder('一句话就好').fill('爽快')
  await seller.getByRole('button', { name: '提交评价' }).click()
  await expect(seller.getByText('你已评价过对方')).toBeVisible()

  // 双方个人页可见信誉记录
  await seller.goto(`/u/${b.id}`)
  await expectReputation(seller, '5.0', 1, 1)
  await expect(seller.getByText('爽快')).toBeVisible()
  await buyer.goto(`/u/${a.id}`)
  await expectReputation(buyer, '4.0', 1, 1)
  await expect(buyer.getByText('书很新')).toBeVisible()

  // 圈子归档后帖子只读，信誉不变
  await archiveCircle(request, circleId)
  await seller.goto(`/p/${postId}`)
  await expect(seller.getByText('圈子已归档，不能再回复')).toBeVisible()
  await seller.goto(`/u/${b.id}`)
  await expectReputation(seller, '5.0', 1, 1)
})
