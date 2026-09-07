import { expect } from 'vitest'
import { app } from '../src/app'

export class TestUser {
  cookie = ''
  constructor(readonly name: string) {}

  async req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookie) headers.set('cookie', this.cookie)
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    const res = await app.request(path, { ...init, headers })
    const setCookies = res.headers.getSetCookie()
    if (setCookies.length > 0) {
      this.cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
    }
    return res
  }

  async json<T = Record<string, unknown>>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: T }> {
    const res = await this.req(path, init)
    return { status: res.status, body: (await res.json()) as T }
  }

  post<T = Record<string, unknown>>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: 'POST',
      body: body === undefined ? '{}' : JSON.stringify(body),
    })
  }

  put<T = Record<string, unknown>>(path: string, body: unknown) {
    return this.json<T>(path, { method: 'PUT', body: JSON.stringify(body) })
  }

  delete<T = Record<string, unknown>>(path: string) {
    return this.json<T>(path, { method: 'DELETE' })
  }

  async signUp(email: string): Promise<string> {
    const { status, body } = await this.post('/api/auth/sign-up/email', {
      email,
      password: 'password-123',
      name: this.name,
    })
    expect(status).toBe(200)
    return (body as { user: { id: string } }).user.id
  }
}

// 管理员按用户 id 认，测试里注册后用钩子指定
export async function becomeAdmin(user: TestUser, email: string): Promise<string> {
  const id = await user.signUp(email)
  const { status } = await user.post('/api/test/admin', { userId: id })
  expect(status).toBe(200)
  return id
}

// 走真实路径拿资格：管理员发码，开发者兑换
export async function makeDeveloper(admin: TestUser, dev: TestUser): Promise<void> {
  const issued = await admin.post<{ codes: string[] }>('/api/developers/invites', { count: 1 })
  expect(issued.status).toBe(201)
  const redeemed = await dev.post('/api/developers/redeem', { code: issued.body.codes[0] })
  expect(redeemed.status).toBe(201)
}
