import { strFromU8, unzipSync } from 'fflate'
import {
  TOOL_MANIFEST_FILE,
  TOOL_PACKAGE_MAX_BYTES,
  toolManifestSchema,
  type ToolManifest,
} from '@harth/shared'

export interface ToolPackage {
  manifest: ToolManifest
  files: Record<string, Uint8Array>
}

export interface CheckResult {
  name: string
  ok: boolean
  detail?: string
}

const ALLOWED_EXTENSIONS = new Set([
  'html', 'htm', 'js', 'mjs', 'css', 'json', 'map', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
  'woff', 'woff2', 'ttf', 'otf', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'wasm',
])

const TEXT_EXTENSIONS = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'svg'])

const MAX_FILES = 500

export function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? '')
}

export class PackageError extends Error {}

export function openPackage(zip: Uint8Array): ToolPackage {
  if (zip.byteLength > TOOL_PACKAGE_MAX_BYTES) {
    throw new PackageError(`包超过 ${TOOL_PACKAGE_MAX_BYTES / 1024 / 1024} MB`)
  }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip)
  } catch {
    throw new PackageError('不是有效的 zip 文件')
  }
  const files: Record<string, Uint8Array> = {}
  let total = 0
  for (const [rawName, data] of Object.entries(entries)) {
    if (rawName.endsWith('/')) continue
    const name = rawName.replace(/\\/g, '/').replace(/^\.\//, '')
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\0')) {
      throw new PackageError(`非法路径：${rawName}`)
    }
    if (name.startsWith('.') || name.includes('/.')) continue
    total += data.byteLength
    files[name] = data
  }
  if (Object.keys(files).length === 0) throw new PackageError('包是空的')
  if (Object.keys(files).length > MAX_FILES) throw new PackageError(`文件数超过 ${MAX_FILES}`)
  if (total > TOOL_PACKAGE_MAX_BYTES) throw new PackageError('解压后体积超过上限')

  const raw = files[TOOL_MANIFEST_FILE]
  if (!raw) throw new PackageError(`缺少 ${TOOL_MANIFEST_FILE}`)
  let json: unknown
  try {
    json = JSON.parse(strFromU8(raw))
  } catch {
    throw new PackageError(`${TOOL_MANIFEST_FILE} 不是合法的 JSON`)
  }
  const parsed = toolManifestSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new PackageError(
      `${TOOL_MANIFEST_FILE} 里 ${issue?.path.join('.') || '内容'}：${issue?.message ?? '格式不对'}`,
    )
  }
  if (!files[parsed.data.entry]) throw new PackageError(`入口文件不存在：${parsed.data.entry}`)
  return { manifest: parsed.data, files }
}

const externalUrl = /https?:\/\/[^\s"'`<>)]+/gi

export function runChecks(pkg: ToolPackage, allowedOrigins: string[]): CheckResult[] {
  const results: CheckResult[] = []

  const badTypes = Object.keys(pkg.files).filter((name) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return !ALLOWED_EXTENSIONS.has(ext)
  })
  results.push({
    name: '文件类型',
    ok: badTypes.length === 0,
    detail: badTypes.length ? `不允许的文件：${badTypes.slice(0, 5).join('、')}` : undefined,
  })

  const external = new Set<string>()
  for (const [name, data] of Object.entries(pkg.files)) {
    if (!isTextFile(name)) continue
    const text = strFromU8(data)
    for (const match of text.matchAll(externalUrl)) {
      const url = match[0]
      if (allowedOrigins.some((origin) => url.startsWith(origin))) continue
      try {
        external.add(new URL(url).host)
      } catch {
        external.add(url)
      }
    }
  }
  results.push({
    name: '外部资源',
    ok: external.size === 0,
    detail: external.size ? `引用了站外地址：${[...external].slice(0, 5).join('、')}` : undefined,
  })

  return results
}

export function textFiles(pkg: ToolPackage, maxBytes: number): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  let used = 0
  for (const [name, data] of Object.entries(pkg.files)) {
    if (!isTextFile(name)) continue
    const text = strFromU8(data)
    if (used + text.length > maxBytes) {
      out.push({ name, text: text.slice(0, Math.max(0, maxBytes - used)) })
      break
    }
    used += text.length
    out.push({ name, text })
  }
  return out
}
