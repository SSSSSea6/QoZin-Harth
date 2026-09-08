import { and, eq, or } from 'drizzle-orm'
import { db } from '../db'
import { userBlocks } from '../db/schema'
import { fail } from '../http'

export async function block(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw fail(400, 'BAD_REQUEST', '不能屏蔽自己')
  await db.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing()
}

export async function unblock(blockerId: string, blockedId: string): Promise<void> {
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
}

export async function listBlocks(blockerId: string): Promise<{ id: string; createdAt: Date }[]> {
  const rows = await db
    .select({ id: userBlocks.blockedId, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(userBlocks.createdAt)
  return rows
}

// 私聊两个方向都断：任一方屏蔽了对方就不能发
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function assertNotBlocked(a: string, b: string): Promise<void> {
  if (await blockedEitherWay(a, b)) throw fail(403, 'BLOCKED', '对方或你已屏蔽，不能私聊')
}
