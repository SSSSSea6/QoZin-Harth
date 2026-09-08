import { z } from 'zod'
import { CRON_PATTERN } from './cron'

export const TOOL_SCOPES = {
  'user.profile': '当前用户的 id 和昵称',
  storage: '在这个圈里保存工具自己的数据',
  'circle.read': '圈子名称和成员数',
  'members.read': '成员列表',
  'posts.read': '圈内帖子',
  'posts.write': '以工具的名义发讨论帖',
  schedule: '按清单里的时间表定时运行',
} as const

export type ToolScope = keyof typeof TOOL_SCOPES

export const TOOL_SCOPE_KEYS = Object.keys(TOOL_SCOPES) as [ToolScope, ...ToolScope[]]

export const DEFAULT_TOOL_SCOPES: ToolScope[] = ['user.profile', 'storage']

export const TOOL_MANIFEST_FILE = 'harth.json'
export const TOOL_PACKAGE_MAX_BYTES = 5 * 1024 * 1024
export const TOOL_STORAGE_VALUE_MAX_BYTES = 64 * 1024
export const TOOL_STORAGE_MAX_KEYS = 1000
// 后端文件要能完整落进 AI 审核的文本预算
export const TOOL_BACKEND_MAX_BYTES = 48 * 1024
export const TOOL_REVIEW_TEXT_BUDGET = 60_000
export const TOOL_ACTION_INPUT_MAX_BYTES = 16 * 1024
export const TOOL_SCHEDULES_MAX = 5
export const TOOL_SCHEDULE_MIN_INTERVAL_MINUTES = 10

export const TOOL_RUN_LIMITS = {
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  scriptMs: 2_000,
  totalMs: 10_000,
  hostCallMs: 5_000,
  hostCalls: 100,
  hostConcurrency: 4,
  hostBytes: 2 * 1024 * 1024,
  posts: 3,
  logBytes: 8 * 1024,
  resultBytes: 64 * 1024,
  scheduledRunsPerHour: 12,
  queue: 20,
  concurrency: 2,
} as const

export const TOOL_RUN_ERROR_CODES = {
  GUEST_ERROR: '代码抛出了异常',
  SCRIPT_TIME: '脚本执行超时',
  MEMORY: '内存超限',
  TIMEOUT: '总时长超时',
  BUDGET: '超出调用或写入额度',
  QUOTA: '开发者本月燃料已用完',
  SUSPENDED: '工具已被停用',
  ACTION_MISSING: '动作不存在',
  FORBIDDEN: '没有权限',
  HOST_ERROR: '平台接口出错',
} as const

export type ToolRunErrorCode = keyof typeof TOOL_RUN_ERROR_CODES

export const TOOL_RUN_TRIGGERS = ['call', 'schedule', 'manual'] as const
export type ToolRunTrigger = (typeof TOOL_RUN_TRIGGERS)[number]

const RESERVED_SLUGS = new Set(['mine', 'new', 'dev', 'api', 'admin', 'harth', 'review'])

export const toolSlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/, 'slug 只能用小写字母、数字、连字符，3–32 位')
  .refine((slug) => !RESERVED_SLUGS.has(slug), '这个 slug 是保留字')

export const toolActionNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,40}$/, '动作名以小写字母开头，只能用字母、数字、下划线')

export const toolActionSchema = z.object({
  name: toolActionNameSchema,
  description: z.string().trim().min(1).max(200),
  input: z.record(z.string(), z.unknown()).optional(),
  triggers: z.array(z.enum(['call', 'schedule'])).min(1).max(2).default(['call', 'schedule']),
})

export type ToolAction = z.infer<typeof toolActionSchema>

export const toolScheduleSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,40}$/, '时间表名以小写字母开头，只能用字母、数字、下划线、连字符'),
  cron: z.string().regex(CRON_PATTERN, '只接受五段 cron，字段只能用数字、*、,、-、/'),
  action: toolActionNameSchema,
  input: z.record(z.string(), z.unknown()).optional(),
})

export type ToolSchedule = z.infer<typeof toolScheduleSchema>

export const toolManifestSchema = z
  .object({
    slug: toolSlugSchema,
    name: z.string().trim().min(1).max(30),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号形如 1.0.0'),
    description: z.string().trim().min(1).max(200),
    entry: z.string().regex(/^[\w.-]+\.html$/).default('index.html'),
    backend: z.string().regex(/^[\w.-]+\.(?:js|mjs)$/, 'backend 是包根目录下的一个 .js 或 .mjs 文件').optional(),
    permissions: z.array(z.enum(TOOL_SCOPE_KEYS)).max(TOOL_SCOPE_KEYS.length).default(DEFAULT_TOOL_SCOPES),
    actions: z.array(toolActionSchema).max(20).default([]),
    schedules: z.array(toolScheduleSchema).max(TOOL_SCHEDULES_MAX).default([]),
  })
  .superRefine((m, ctx) => {
    if (new Set(m.actions.map((a) => a.name)).size !== m.actions.length) {
      ctx.addIssue({ code: 'custom', path: ['actions'], message: '动作名重复' })
    }
    if (m.actions.length > 0 && !m.backend) {
      ctx.addIssue({ code: 'custom', path: ['backend'], message: '声明了 actions 就要指定 backend 文件' })
    }
    if (m.schedules.length > 0 && !m.permissions.includes('schedule')) {
      ctx.addIssue({ code: 'custom', path: ['permissions'], message: '有 schedules 必须申请 schedule 权限' })
    }
    const seen = new Set<string>()
    m.schedules.forEach((s, i) => {
      if (seen.has(s.name)) ctx.addIssue({ code: 'custom', path: ['schedules', i, 'name'], message: '时间表名重复' })
      seen.add(s.name)
      const action = m.actions.find((a) => a.name === s.action)
      if (!action) {
        ctx.addIssue({ code: 'custom', path: ['schedules', i, 'action'], message: `动作 ${s.action} 没有在 actions 里声明` })
      } else if (!action.triggers.includes('schedule')) {
        ctx.addIssue({ code: 'custom', path: ['schedules', i, 'action'], message: `动作 ${s.action} 不允许定时触发` })
      }
    })
  })

export type ToolManifest = z.infer<typeof toolManifestSchema>

export const toolStorageKeySchema = z.string().regex(/^[\w.:/-]{1,120}$/)

export const toolStorageWriteSchema = z.object({
  value: z.unknown(),
  expectedVersion: z.number().int().positive().optional(),
})

// 用量按"燃料"计，内部用整数单位记账：1 燃料 = 100 单位
export const FUEL_UNIT = 100
export const FUEL_RATE_VERSION = 1

export const FUEL_RATES = {
  run: FUEL_UNIT,
  runPerMs: 1,
  post: 5 * FUEL_UNIT,
  storageWrite: FUEL_UNIT,
  storageWritePerKiB: FUEL_UNIT / 4,
  holdingPerMiBDay: FUEL_UNIT,
} as const

// 每月免费额度（单位）：有开发者资格 20 000 燃料，没有资格的调试额度 2 000 燃料
export const FUEL_ALLOWANCE = {
  developer: 20_000 * FUEL_UNIT,
  basic: 2_000 * FUEL_UNIT,
} as const

// 一次运行准入时预留的上限：固定部分 + 总时长上限
export const FUEL_RUN_RESERVE = FUEL_RATES.run + TOOL_RUN_LIMITS.totalMs * FUEL_RATES.runPerMs

export const TOOL_STORAGE_OWNER_MAX_BYTES = 256 * 1024 * 1024

// 工具数据接口的频率上限（每个 用户 × 工具 × 圈）
export const TOOL_API_LIMITS = {
  readsPerMinute: 60,
  readBurst: 20,
  writesPerMinute: 20,
  postsPerMinute: 6,
} as const

export function fuelForRun(durationMs: number): number {
  const billable = Math.min(Math.max(0, Math.round(durationMs)), TOOL_RUN_LIMITS.totalMs)
  return FUEL_RATES.run + billable * FUEL_RATES.runPerMs
}

export function fuelForStorageWrite(bytes: number): number {
  return FUEL_RATES.storageWrite + Math.ceil((bytes * FUEL_RATES.storageWritePerKiB) / 1024)
}

export function fuelForHolding(bytes: number, days = 1): number {
  return Math.ceil((bytes * FUEL_RATES.holdingPerMiBDay * days) / (1024 * 1024))
}

export function formatFuel(units: number): string {
  return Math.round(units / FUEL_UNIT).toLocaleString('zh-CN')
}

// 账期按上海时间
const shanghaiDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function billingDay(at: Date = new Date()): string {
  return shanghaiDay.format(at)
}

export function billingMonth(at: Date = new Date()): string {
  return billingDay(at).slice(0, 7)
}
