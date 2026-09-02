// 内嵌 Postgres（embedded-postgres 的平台二进制），开发库和测试库共用。
// Windows 上 initdb 不接受含非 ASCII 字符的路径，所以二进制经 ~/.harth/pgdist
// 这个 junction 运行，数据目录也放在 ~/.harth 下。
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'

export const HARTH_DIR = join(homedir(), '.harth')
const DIST_LINK = join(HARTH_DIR, 'pgdist')
const IS_WINDOWS = process.platform === 'win32'

const cleanEnv = {
  ...process.env,
  LC_ALL: 'C',
  LC_MESSAGES: 'C',
  LANG: 'C',
}

let binDir = ''

function platformPackage(): string {
  const os = IS_WINDOWS ? 'windows' : process.platform
  return `@embedded-postgres/${os}-${process.arch}`
}

function findNativeDir(): string {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('embedded-postgres')
  const pkg = platformPackage()
  // 平台包没有导出 package.json，从主入口反推包根
  const mainEntry = createRequire(entry).resolve(pkg)
  const marker = join(...pkg.split('/'))
  const packageRoot = mainEntry.slice(
    0,
    mainEntry.lastIndexOf(marker) + marker.length,
  )
  return join(packageRoot, 'native')
}

export async function prepareBinaries(): Promise<void> {
  const target = findNativeDir()
  if (!existsSync(target)) {
    throw new Error(
      `未找到内嵌 Postgres 二进制：${target}（先 pnpm install；当前平台 ${platformPackage()}）`,
    )
  }
  await mkdir(HARTH_DIR, { recursive: true })
  if (IS_WINDOWS) {
    const current = existsSync(DIST_LINK) ? realpathSync.native(DIST_LINK) : null
    if (current !== realpathSync.native(target)) {
      if (current) await rm(DIST_LINK, { recursive: true, force: true })
      await symlink(target, DIST_LINK, 'junction')
    }
    binDir = join(DIST_LINK, 'bin')
    return
  }
  binDir = join(target, 'bin')
  for (const name of ['initdb', 'pg_ctl', 'postgres']) {
    await chmod(join(binDir, name), 0o755)
  }
}

function bin(name: string): string {
  if (!binDir) throw new Error('先调用 prepareBinaries()')
  return join(binDir, IS_WINDOWS ? `${name}.exe` : name)
}

export async function initCluster(dataDir: string): Promise<void> {
  const pwfile = join(tmpdir(), `harth-pw-${Date.now()}.txt`)
  await writeFile(pwfile, 'harth_dev\n', 'ascii')
  try {
    execFileSync(
      bin('initdb'),
      [
        `--pgdata=${dataDir}`,
        '--auth=password',
        '--username=harth',
        `--pwfile=${pwfile}`,
        '--encoding=UTF8',
        '--locale=C',
        '--lc-messages=C',
      ],
      { stdio: 'inherit', env: cleanEnv },
    )
  } finally {
    await rm(pwfile, { force: true })
  }
}

export function pgCtl(dataDir: string, args: string[]): void {
  execFileSync(bin('pg_ctl'), [`--pgdata=${dataDir}`, ...args], {
    stdio: 'inherit',
    env: cleanEnv,
  })
}

// stdio 不能继承：postgres 会一直握着父进程的管道
export function startCluster(dataDir: string, port: number, logFile: string): void {
  execFileSync(
    bin('pg_ctl'),
    [`--pgdata=${dataDir}`, '--log', logFile, '-o', `-p ${port}`, 'start'],
    { stdio: 'ignore', env: cleanEnv },
  )
}

export function stopCluster(dataDir: string): void {
  pgCtl(dataDir, ['-m', 'fast', 'stop'])
}

export async function ensureDatabase(port: number, name: string): Promise<void> {
  const client = new Client({
    connectionString: `postgres://harth:harth_dev@localhost:${port}/postgres`,
  })
  await client.connect()
  const exists = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [name],
  )
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE ${name}`)
  }
  await client.end()
}
