import type { PgBoss } from 'pg-boss'

// 进程里唯一的队列实例，index.ts 启动后注入；没有实例时通知只进收件箱不投递
let instance: PgBoss | null = null

export function setBoss(boss: PgBoss | null): void {
  instance = boss
}

export function getBoss(): PgBoss | null {
  return instance
}

export const NOTIFY_QUEUE = 'notify-deliver'
