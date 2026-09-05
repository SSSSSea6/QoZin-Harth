import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { API_URL, WEB_URL } from '../playwright.config'

export const SCHOOL = '南京航空航天大学'

// 管理员账号在 playwright.config 的 HARTH_ADMIN_EMAILS 里；重试时账号已存在，注册失败就直接登录
export async function adminSession(request: APIRequestContext): Promise<void> {
  const account = { email: 'admin@e2e.test', password: 'e2e-password' }
  const headers = { Origin: WEB_URL }
  await request.post(`${API_URL}/api/auth/sign-up/email`, { headers, data: { name: '管理员', ...account } })
  const signIn = await request.post(`${API_URL}/api/auth/sign-in/email`, { headers, data: account })
  expect(signIn.ok(), await signIn.text()).toBeTruthy()
}

const COUNTER_TOOL_HTML = `<!doctype html><meta charset="utf-8">
<p id="who">连接中</p><button id="add">加一</button><p id="count"></p>
<script src="/_harth/sdk.js"></script>
<script>
(async () => {
  const ctx = await harth.connect()
  document.getElementById('who').textContent = ctx.user.name + ' 在 ' + ctx.circle.name
  const show = async () => {
    const item = await harth.storage.get('count')
    document.getElementById('count').textContent = '计数 ' + (item ? item.value : 0)
  }
  document.getElementById('add').onclick = async () => {
    const item = await harth.storage.get('count')
    await harth.storage.set('count', (item ? item.value : 0) + 1)
    await show()
  }
  await show()
})()
</script>`

// 测试夹具：一个用平台存储计数的工具包
export function counterBundle(slug: string, name: string, version = '1.0.0'): Buffer {
  const files = {
    'harth.json': strToU8(
      JSON.stringify({ slug, name, version, description: '测试夹具', permissions: ['user.profile', 'storage'] }),
    ),
    'index.html': strToU8(COUNTER_TOOL_HTML),
  }
  return Buffer.from(zipSync(files))
}

export interface User {
  id: string
  name: string
  email: string
}

let sequence = 0

// 并行用例和重试之间圈名不重复
export function uniqueName(base: string): string {
  return `${base}${Math.random().toString(36).slice(2, 6)}`
}

export async function register(page: Page, name: string): Promise<User> {
  const email = `u${Date.now()}-${process.pid}-${sequence++}@example.com`
  await page.goto('/')
  await page.getByRole('tab', { name: '注册' }).click()
  // 切换瞬间登录面板还没卸载
  const form = page.getByRole('tabpanel', { name: '注册' })
  await form.getByLabel('昵称').fill(name)
  await form.getByLabel('邮箱').fill(email)
  await form.getByLabel('密码').fill('e2e-password')
  await form.getByRole('button', { name: '注册' }).click()
  await expect(page.getByRole('heading', { name: '首页' })).toBeVisible()
  const href = await page.locator('header a[href^="/u/"]').getAttribute('href')
  return { id: href!.slice('/u/'.length), name, email }
}

export async function joinSchool(page: Page): Promise<void> {
  await page.goto('/')
  const aside = page.getByRole('complementary')
  await aside.getByRole('button', { name: '加入' }).click()
  await expect(aside.getByRole('button', { name: '加入' })).toHaveCount(0)
}

export async function createCircle(
  page: Page,
  name: string,
  parent: string,
): Promise<string> {
  await page.goto('/circles/new')
  await page.getByLabel('圈子名字').fill(name)
  await page.getByLabel(parent, { exact: true }).check()
  await page.getByRole('button', { name: '点火' }).click()
  await page.waitForURL(/\/c\/[^/?]+$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().split('/c/')[1]!
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export async function setCircleTimes(
  request: APIRequestContext,
  circleId: string,
  times: { lastActivityAt?: string; hibernationDeadline?: string | null },
): Promise<void> {
  const res = await request.post(`${API_URL}/api/test/circle-times`, {
    data: { circleId, ...times },
  })
  expect(res.ok()).toBeTruthy()
}

export async function sweep(
  request: APIRequestContext,
): Promise<{ hibernated: number; woken: number; archived: number }> {
  const res = await request.post(`${API_URL}/api/test/sweep`, { data: {} })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

export async function archiveCircle(
  request: APIRequestContext,
  circleId: string,
): Promise<void> {
  await setCircleTimes(request, circleId, {
    lastActivityAt: daysAgo(120),
    hibernationDeadline: daysAgo(1),
  })
  expect((await sweep(request)).archived).toBeGreaterThan(0)
}

export async function expectReputation(
  page: Page,
  rating: string,
  reviews: number,
  completed: number,
): Promise<void> {
  await expect(page.locator('dl')).toHaveText(
    new RegExp(
      `${rating.replace('.', '\.')}\s*评分\s*${reviews}\s*收到评价\s*${completed}\s*完成交接`,
    ),
  )
}
