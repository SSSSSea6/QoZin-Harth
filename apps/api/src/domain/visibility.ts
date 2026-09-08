import { and, eq, isNull, notExists, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { db } from '../db'
import { userBlocks } from '../db/schema'

// 列表与计数在 SQL 里过滤：被隐藏的内容不出现，viewer 屏蔽的作者不出现
export function notHidden(hiddenAt: PgColumn): SQL {
  return isNull(hiddenAt)
}

export function notBlockedBy(viewerId: string, authorId: PgColumn): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, authorId))),
  )
}

export function visibleTo(viewerId: string, hiddenAt: PgColumn, authorId: PgColumn): SQL {
  return and(notHidden(hiddenAt), notBlockedBy(viewerId, authorId))!
}

// 详情与会话时间线里的占位：不带原文
export const HIDDEN_PLACEHOLDER = '内容已被处理'
