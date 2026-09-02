// 本地开发库：内嵌 Postgres 17，数据在 ~/.harth/pgdata，端口 5432
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureDatabase,
  prepareBinaries,
  HARTH_DIR,
  initCluster,
  startCluster,
  stopCluster,
} from './embedded-pg'

const DATA_DIR = join(HARTH_DIR, 'pgdata')

await prepareBinaries()
if (!existsSync(DATA_DIR)) {
  await initCluster(DATA_DIR)
}

startCluster(DATA_DIR, 5432, join(HARTH_DIR, 'pg.log'))
await ensureDatabase(5432, 'harth')

console.log(
  `postgres 17 就绪：postgres://harth:***@localhost:5432/harth（数据目录 ${DATA_DIR}，Ctrl+C 停止）`,
)

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    try {
      stopCluster(DATA_DIR)
    } finally {
      process.exit(0)
    }
  })
}

// 保持进程存活
setInterval(() => {}, 1 << 30)
