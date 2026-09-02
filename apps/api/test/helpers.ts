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
