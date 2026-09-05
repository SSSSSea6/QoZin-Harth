import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ToolManifest } from '@harth/shared'
import { Hono, type Context } from 'hono'
import { env } from '../env'
import { currentVersion, getTool, getVersion } from '../tools/service'
import { readPackageFile } from '../tools/store'
import { verifyPreviewPath } from '../tools/token'

const SDK_PATH = fileURLToPath(new URL('../../../../packages/sdk/dist/sdk.js', import.meta.url))

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
}

function contentType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

function csp(): string {
  const api = new URL(env.BETTER_AUTH_URL).origin
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${api}`,
    `frame-ancestors ${env.WEB_URL}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

async function servePackageFile(
  c: Context,
  toolId: string,
  versionId: string,
  manifest: ToolManifest,
  prefix: string,
): Promise<Response> {
  let path = decodeURIComponent(c.req.path.slice(prefix.length))
  if (path === '' || path.endsWith('/')) path += manifest.entry
  const file = await readPackageFile(toolId, versionId, path)
  if (!file) return c.text('文件不存在', 404)
  const type = contentType(path)
  return c.body(new Uint8Array(file), 200, {
    'Content-Type': type,
    'Content-Security-Policy': csp(),
    'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  })
}

export const toolStaticApp = new Hono()
  .get('/_harth/sdk.js', async (c) => {
    const file = await readFile(SDK_PATH)
    return c.body(new Uint8Array(file), 200, {
      'Content-Type': CONTENT_TYPES.js!,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    })
  })

  .get('/t/:slug/*', async (c) => {
    const slug = c.req.param('slug')
    const tool = await getTool(slug)
    const version = tool ? await currentVersion(tool) : null
    if (!tool || !version) return c.text('工具不存在或还没上架', 404)
    return servePackageFile(c, tool.id, version.id, version.manifest as ToolManifest, `/t/${slug}/`)
  })

  // 管理员试运行：签名在路径里，整包文件都在同一前缀下
  .get('/review/:id/:sig/*', async (c) => {
    const id = c.req.param('id')
    const sig = c.req.param('sig')
    const version = verifyPreviewPath(id, sig) ? await getVersion(id) : null
    if (!version) return c.text('试运行链接不存在或已过期', 404)
    return servePackageFile(c, version.toolId, version.id, version.manifest as ToolManifest, `/review/${id}/${sig}/`)
  })
