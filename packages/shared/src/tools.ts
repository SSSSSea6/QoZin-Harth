import { z } from 'zod'

export const TOOL_SCOPES = {
  'user.profile': '当前用户的 id 和昵称',
  storage: '在这个圈里保存工具自己的数据',
  'circle.read': '圈子名称和成员数',
  'members.read': '成员列表',
  'posts.read': '圈内帖子',
  'posts.write': '以工具的名义发讨论帖',
} as const

export type ToolScope = keyof typeof TOOL_SCOPES

export const TOOL_SCOPE_KEYS = Object.keys(TOOL_SCOPES) as [ToolScope, ...ToolScope[]]

export const DEFAULT_TOOL_SCOPES: ToolScope[] = ['user.profile', 'storage']

export const TOOL_MANIFEST_FILE = 'harth.json'
export const TOOL_PACKAGE_MAX_BYTES = 5 * 1024 * 1024
export const TOOL_STORAGE_VALUE_MAX_BYTES = 64 * 1024
export const TOOL_STORAGE_MAX_KEYS = 1000

const RESERVED_SLUGS = new Set(['mine', 'new', 'dev', 'api', 'admin', 'harth'])

export const toolSlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/, 'slug 只能用小写字母、数字、连字符，3–32 位')
  .refine((slug) => !RESERVED_SLUGS.has(slug), '这个 slug 是保留字')

export const toolActionSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,40}$/),
  description: z.string().trim().min(1).max(200),
  input: z.record(z.string(), z.unknown()).optional(),
})

export const toolManifestSchema = z.object({
  slug: toolSlugSchema,
  name: z.string().trim().min(1).max(30),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号形如 1.0.0'),
  description: z.string().trim().min(1).max(200),
  entry: z.string().regex(/^[\w.-]+\.html$/).default('index.html'),
  permissions: z.array(z.enum(TOOL_SCOPE_KEYS)).max(TOOL_SCOPE_KEYS.length).default(DEFAULT_TOOL_SCOPES),
  actions: z.array(toolActionSchema).max(20).default([]),
})

export type ToolManifest = z.infer<typeof toolManifestSchema>

export const toolStorageKeySchema = z.string().regex(/^[\w.:/-]{1,120}$/)

export const toolStorageWriteSchema = z.object({
  value: z.unknown(),
  expectedVersion: z.number().int().positive().optional(),
})
