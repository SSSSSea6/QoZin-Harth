import { config } from 'dotenv'
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

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  BETTER_AUTH_SECRET,
  TOP_CIRCLE: {
    id: TOP_CIRCLE_ID,
    name: process.env.HARTH_TOP_CIRCLE_NAME ?? '南京航空航天大学',
  },
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  API_PORT: Number(process.env.API_PORT ?? 3001),
  WEB_URL: process.env.WEB_URL ?? 'http://localhost:3000',
  TEST_HOOKS: process.env.HARTH_TEST_HOOKS === '1',
  JOBS: process.env.HARTH_JOBS !== '0',
}
