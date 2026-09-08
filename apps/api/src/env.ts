import { config } from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根 .env，已有的进程环境变量优先
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`缺少环境变量 ${name}（参照 .env.example）`)
  return value
}

const TOP_CIRCLE_ID = process.env.HARTH_TOP_CIRCLE_ID ?? 'nuaa'
if (!/^[a-z0-9-]{2,32}$/.test(TOP_CIRCLE_ID)) {
  throw new Error('HARTH_TOP_CIRCLE_ID 只能是 2–32 位小写字母、数字、连字符')
}

const BETTER_AUTH_SECRET = required('BETTER_AUTH_SECRET')
if (process.env.NODE_ENV === 'production' && BETTER_AUTH_SECRET === 'change-me') {
  throw new Error('生产环境必须设置随机的 BETTER_AUTH_SECRET（openssl rand -base64 32）')
}

const PRODUCTION = process.env.NODE_ENV === 'production'

// 站点模式：production 是对外运营，preview 是内部预览；对外运营时门禁不能关、测试钩子不能开
const SITE_MODE = process.env.HARTH_SITE_MODE ?? (PRODUCTION ? 'production' : 'preview')
if (SITE_MODE !== 'production' && SITE_MODE !== 'preview') {
  throw new Error('HARTH_SITE_MODE 只能是 production 或 preview')
}
const PUBLIC_SITE = SITE_MODE === 'production'
const PHONE_REQUIRED_RAW = process.env.HARTH_PHONE_REQUIRED ?? '1'
if (PHONE_REQUIRED_RAW !== '1' && PHONE_REQUIRED_RAW !== '0') {
  throw new Error('HARTH_PHONE_REQUIRED 只能是 1 或 0')
}
if (PUBLIC_SITE && PHONE_REQUIRED_RAW !== '1') {
  throw new Error('对外运营（HARTH_SITE_MODE=production）必须 HARTH_PHONE_REQUIRED=1')
}
if (PRODUCTION && process.env.HARTH_TEST_HOOKS === '1') {
  throw new Error('生产构建不能开 HARTH_TEST_HOOKS')
}
if (PUBLIC_SITE && process.env.HARTH_JOBS === '0') {
  throw new Error('对外运营不能关 HARTH_JOBS：收了消息却永不投递')
}
const SMS_PROVIDER = process.env.HARTH_SMS_PROVIDER ?? (process.env.HARTH_SMS_ACCESS_KEY_ID ? 'aliyun' : 'none')
if (!['aliyun', 'test', 'none'].includes(SMS_PROVIDER)) {
  throw new Error('HARTH_SMS_PROVIDER 只能是 aliyun、test 或不设')
}
if (SMS_PROVIDER === 'test' && (PRODUCTION || process.env.HARTH_TEST_HOOKS !== '1')) {
  throw new Error('HARTH_SMS_PROVIDER=test 只能和 HARTH_TEST_HOOKS=1 一起用，且不能在生产构建')
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  BETTER_AUTH_SECRET,
  PRODUCTION,
  SITE_MODE: SITE_MODE as 'production' | 'preview',
  PHONE_REQUIRED: PHONE_REQUIRED_RAW === '1',
  SMS:
    SMS_PROVIDER === 'aliyun'
      ? {
          provider: 'aliyun' as const,
          accessKeyId: required('HARTH_SMS_ACCESS_KEY_ID'),
          accessKeySecret: required('HARTH_SMS_ACCESS_KEY_SECRET'),
          signName: required('HARTH_SMS_SIGN_NAME'),
          templateCode: required('HARTH_SMS_TEMPLATE_CODE'),
        }
      : SMS_PROVIDER === 'test'
        ? { provider: 'test' as const }
        : null,
  TOP_CIRCLE: {
    id: TOP_CIRCLE_ID,
    name: process.env.HARTH_TOP_CIRCLE_NAME ?? '南京航空航天大学',
  },
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  API_PORT: Number(process.env.API_PORT ?? 3001),
  WEB_URL: process.env.WEB_URL ?? 'http://localhost:3000',
  // 工具页面的源；必须与 WEB_URL 不同源，默认用 api 自己的地址
  TOOL_ORIGIN: process.env.HARTH_TOOL_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  TOOLS_DIR: process.env.HARTH_TOOLS_DIR ?? join(homedir(), '.harth', 'tools'),
  // 管理员按用户 id 认，邮箱没有验证过，不能当身份用
  ADMIN_IDS: (process.env.HARTH_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  REVIEW: process.env.HARTH_REVIEW_API_KEY
    ? {
        apiUrl: process.env.HARTH_REVIEW_API_URL ?? 'https://api.deepseek.com/v1',
        apiKey: process.env.HARTH_REVIEW_API_KEY,
        model: process.env.HARTH_REVIEW_MODEL ?? 'deepseek-chat',
      }
    : null,
  TEST_HOOKS: process.env.HARTH_TEST_HOOKS === '1',
  JOBS: process.env.HARTH_JOBS !== '0',
  APNS: process.env.HARTH_APNS_KEY
    ? {
        key: Buffer.from(process.env.HARTH_APNS_KEY, 'base64').toString('utf8'),
        keyId: required('HARTH_APNS_KEY_ID'),
        teamId: required('HARTH_APNS_TEAM_ID'),
        bundleId: required('HARTH_APNS_BUNDLE_ID'),
        production: process.env.HARTH_APNS_ENV !== 'sandbox',
      }
    : null,
  EMAS: process.env.HARTH_EMAS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.HARTH_EMAS_ACCESS_KEY_ID,
        accessKeySecret: required('HARTH_EMAS_ACCESS_KEY_SECRET'),
        appKey: required('HARTH_EMAS_APP_KEY'),
        region: process.env.HARTH_EMAS_REGION ?? 'cn-hangzhou',
      }
    : null,
  TOOL_RUNS: process.env.HARTH_TOOL_RUNS !== '0',
}

// 测试钩子临时指定的管理员，只在 HARTH_TEST_HOOKS=1 时有内容
const testAdmins = new Set<string>()

export function grantTestAdmin(userId: string): void {
  if (!env.TEST_HOOKS) throw new Error('只有测试钩子能指定管理员')
  testAdmins.add(userId)
}

export function isAdmin(user: { id: string }): boolean {
  return env.ADMIN_IDS.includes(user.id) || testAdmins.has(user.id)
}
