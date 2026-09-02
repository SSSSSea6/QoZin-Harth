import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { zipSync } from 'fflate'
import { TOOL_MANIFEST_FILE, toolManifestSchema, type ToolManifest } from '@harth/shared'

const CONFIG_DIR = join(homedir(), '.harth')
const CONFIG_FILE = join(CONFIG_DIR, 'cli.json')
const CLIENT_ID = 'harth-cli'
const DEFAULT_API = 'http://localhost:3001'

interface Config {
  apiUrl: string
  token?: string
  user?: { id: string; name: string; email: string }
}

class CliError extends Error {}

async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as Config
  } catch {
    return { apiUrl: process.env.HARTH_API_URL ?? DEFAULT_API }
  }
}

async function writeConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

async function api<T>(config: Config, path: string, init: RequestInit = {}): Promise<T> {
  if (!config.token) throw new CliError('还没登录，先运行 harth login')
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${config.token}`,
    },
  })
  if (res.status === 401) throw new CliError('登录已失效，重新运行 harth login')
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new CliError(body.error ?? `请求失败（${res.status}）`)
  return body
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
  } catch {
    // 打不开浏览器就让用户手动打开
  }
}

let prompt: ReturnType<typeof createInterface> | null = null

async function ask(question: string, fallback = ''): Promise<string> {
  prompt ??= createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await prompt.question(fallback ? `${question}（${fallback}）：` : `${question}：`)).trim()
  return answer || fallback
}

async function readManifest(dir: string): Promise<ToolManifest> {
  const file = join(dir, TOOL_MANIFEST_FILE)
  if (!existsSync(file)) throw new CliError(`当前目录没有 ${TOOL_MANIFEST_FILE}，先运行 harth init`)
  const parsed = toolManifestSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CliError(`${TOOL_MANIFEST_FILE} 里 ${issue?.path.join('.') || '内容'}：${issue?.message}`)
  }
  return parsed.data
}

// ---------- login ----------

async function login(apiOverride?: string): Promise<void> {
  const config = await readConfig()
  if (apiOverride) config.apiUrl = apiOverride.replace(/\/$/, '')
  const codeRes = await fetch(`${config.apiUrl}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })
  if (!codeRes.ok) throw new CliError(`连不上 ${config.apiUrl}（${codeRes.status}）`)
  const code = (await codeRes.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    interval?: number
    expires_in: number
  }
  const url = code.verification_uri_complete ?? code.verification_uri
  console.log(`在浏览器里确认登录：${url}`)
  console.log(`验证码：${code.user_code}`)
  openBrowser(url)

  let interval = (code.interval ?? 5) * 1000
  const deadline = Date.now() + code.expires_in * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    const tokenRes = await fetch(`${config.apiUrl}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.device_code,
        client_id: CLIENT_ID,
      }),
    })
    const body = (await tokenRes.json()) as { access_token?: string; error?: string }
    if (body.access_token) {
      config.token = body.access_token
      const session = await api<{ user: { id: string; name: string; email: string } }>(
        config,
        '/api/auth/get-session',
      )
      config.user = session.user
      await writeConfig(config)
      console.log(`已登录：${session.user.name}（${session.user.email}）`)
      return
    }
    if (body.error === 'slow_down') interval += 5000
    else if (body.error === 'access_denied') throw new CliError('你在浏览器里拒绝了登录')
    else if (body.error === 'expired_token') break
    else if (body.error && body.error !== 'authorization_pending') throw new CliError(body.error)
  }
  throw new CliError('验证码已过期，重新运行 harth login')
}

// ---------- init ----------

const TEMPLATE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__NAME__</title>
  <style>
    body { margin: 0; padding: 16px; font: 15px/1.6 system-ui, sans-serif; color: #1f2328; }
    button { font: inherit; padding: 6px 12px; }
  </style>
</head>
<body>
  <p id="hello">连接中…</p>
  <button id="save">记一下</button>
  <p id="count"></p>
  <script src="/_harth/sdk.js"></script>
  <script>
    (async () => {
      const ctx = await harth.connect()
      document.getElementById('hello').textContent = ctx.user.name + '，你在「' + ctx.circle.name + '」里'
      const show = async () => {
        const item = await harth.storage.get('count')
        document.getElementById('count').textContent = '这个圈里一共记了 ' + (item ? item.value : 0) + ' 次'
      }
      document.getElementById('save').onclick = async () => {
        const item = await harth.storage.get('count')
        await harth.storage.set('count', (item ? item.value : 0) + 1, { expectedVersion: item ? item.version : undefined })
        await show()
      }
      await show()
    })()
  </script>
</body>
</html>
`

async function init(
  target: string | undefined,
  options: { name?: string; description?: string },
): Promise<void> {
  const dir = resolve(target ?? '.')
  const manifestPath = join(dir, TOOL_MANIFEST_FILE)
  if (existsSync(manifestPath)) throw new CliError(`${manifestPath} 已存在`)
  const slug = basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const name = options.name ?? (await ask('工具名字', slug))
  const description = options.description ?? (await ask('一句话说明它做什么', name))
  const manifest = toolManifestSchema.parse({ slug, name, version: '0.1.0', description })
  await mkdir(dir, { recursive: true })
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(dir, manifest.entry), TEMPLATE_HTML.replace('__NAME__', name))
  console.log(`已创建 ${relative(process.cwd(), dir) || '.'}/：${TOOL_MANIFEST_FILE}、${manifest.entry}`)
  console.log('下一步：harth dev')
}

// ---------- dev ----------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

async function dev(options: { port: number; circle?: string }): Promise<void> {
  const config = await readConfig()
  const dir = process.cwd()
  let manifest = await readManifest(dir)

  const sdkRes = await fetch(`${config.apiUrl}/_harth/sdk.js`)
  if (!sdkRes.ok) throw new CliError(`拿不到 SDK：${config.apiUrl}/_harth/sdk.js（${sdkRes.status}）`)
  const sdk = await sdkRes.text()

  let circleId = options.circle
  if (!circleId) {
    const mine = await api<{ circles: { id: string; name: string; role: string; isDm: boolean }[] }>(
      config,
      '/api/circles/mine',
    )
    const candidates = mine.circles.filter((c) => !c.isDm)
    if (candidates.length === 0) throw new CliError('你还没有加入任何圈子，先在火塘里建一个用来开发')
    console.log('在哪个圈里调试：')
    candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}${c.role === 'owner' ? '（圈主）' : ''}`))
    const pick = Number(await ask('输入序号', '1'))
    const chosen = candidates[pick - 1]
    if (!chosen) throw new CliError('序号不对')
    circleId = chosen.id
  }

  const url = `http://localhost:${options.port}`
  const register = async () => {
    const res = await api<{ openUrl: string }>(config, '/api/tools/dev-session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circleId, url, manifest }),
    })
    return res.openUrl
  }

  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', url).pathname)
    if (pathname === '/_harth/sdk.js') {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js']! })
      res.end(sdk)
      return
    }
    let file = resolve(dir, '.' + (pathname.endsWith('/') ? pathname + manifest.entry : pathname))
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const data = await readFile(file)
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      res.end(data)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', resolve)
  })

  const openUrl = await register()
  console.log(`本地工具：${url}`)
  console.log(`在火塘里打开：${openUrl}`)
  console.log('改了 harth.json 会自动重新登记；Ctrl+C 结束')
  openBrowser(openUrl)

  watch(join(dir, TOOL_MANIFEST_FILE), async () => {
    try {
      manifest = await readManifest(dir)
      await register()
      console.log('harth.json 已更新')
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
    }
  })

  const stop = async () => {
    server.close()
    await api(config, '/api/tools/dev-session', { method: 'DELETE' }).catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  await new Promise(() => {})
}

// ---------- publish ----------

async function collectFiles(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath, entry.name)
    const rel = relative(dir, full).split(sep).join('/')
    if (rel.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) continue
    files[rel] = new Uint8Array(await readFile(full))
  }
  return files
}

interface VersionView {
  id: string
  version: string
  status: 'pending' | 'approved' | 'rejected'
  review: {
    checks?: { name: string; ok: boolean; detail?: string }[]
    ai?: { verdict: string; summary: string; issues: string[]; usefulness: number }
    admin?: { decision: string; note?: string }
    error?: string
  } | null
}

function describeVersion(v: VersionView): string {
  const lines: string[] = []
  const status = { pending: '审核中', approved: '已上架', rejected: '未通过' }[v.status]
  lines.push(`v${v.version}  ${status}`)
  for (const check of v.review?.checks ?? []) {
    if (!check.ok) lines.push(`  ✗ ${check.name}：${check.detail ?? ''}`)
  }
  if (v.review?.ai) {
    lines.push(`  审核意见：${v.review.ai.summary}`)
    for (const issue of v.review.ai.issues) lines.push(`  - ${issue}`)
  }
  if (v.review?.admin?.note) lines.push(`  管理员备注：${v.review.admin.note}`)
  if (v.review?.error) lines.push(`  审核暂时没跑完：${v.review.error}`)
  return lines.join('\n')
}

async function publish(): Promise<void> {
  const config = await readConfig()
  const dir = process.cwd()
  const manifest = await readManifest(dir)
  const files = await collectFiles(dir)
  const zip = zipSync(files, { level: 6 })
  console.log(`打包 ${Object.keys(files).length} 个文件，${(zip.byteLength / 1024).toFixed(0)} KB，上传 ${manifest.slug}@${manifest.version}…`)
  const res = await api<{ tool: { slug: string }; version: VersionView }>(config, '/api/tools/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zip,
  })
  console.log(describeVersion(res.version))
  if (res.version.status === 'pending') console.log('审核结果用 harth status 查看')
}

async function status(): Promise<void> {
  const config = await readConfig()
  const res = await api<{ tools: { slug: string; name: string; versions: VersionView[] }[] }>(
    config,
    '/api/tools/mine',
  )
  if (res.tools.length === 0) {
    console.log('还没有发布过工具')
    return
  }
  for (const tool of res.tools) {
    console.log(`${tool.name}（${tool.slug}）`)
    for (const v of tool.versions) console.log(describeVersion(v).replace(/^/gm, '  '))
  }
}

// ---------- main ----------

const HELP = `用法：harth <命令>

  login [--api <地址>]   登录火塘
  init <目录> [--name <名字>] [--description <说明>]
                         新建一个工具，目录名就是 slug
  dev [--port 3102] [--circle <圈子id>]
                         本地运行，并在火塘里实时预览
  publish                打包上传，进入审核
  status                 查看审核结果
  whoami                 当前登录账号
  logout                 退出登录
`

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      api: { type: 'string' },
      port: { type: 'string' },
      circle: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const command = positionals[0]
  if (!command || values.help) {
    console.log(HELP)
    return
  }
  switch (command) {
    case 'login':
      return login(values.api)
    case 'init':
      return init(positionals[1], { name: values.name, description: values.description })
    case 'dev':
      return dev({ port: Number(values.port ?? 3102), circle: values.circle })
    case 'publish':
      return publish()
    case 'status':
      return status()
    case 'whoami': {
      const config = await readConfig()
      console.log(config.user ? `${config.user.name}（${config.user.email}）@ ${config.apiUrl}` : '未登录')
      return
    }
    case 'logout': {
      const config = await readConfig()
      await writeConfig({ apiUrl: config.apiUrl })
      console.log('已退出')
      return
    }
    default:
      throw new CliError(`不认识的命令：${command}\n${HELP}`)
  }
}

main()
  .then(() => prompt?.close())
  .catch((err) => {
    console.error(err instanceof CliError ? err.message : err)
    process.exit(1)
  })
