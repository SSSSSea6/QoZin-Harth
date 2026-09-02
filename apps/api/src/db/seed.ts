import { eq } from 'drizzle-orm'
import { env } from '../env'
import { db } from './index'
import { circles } from './schema'

export async function seed(): Promise<void> {
  for (const item of [env.TOP_CIRCLE]) {
    const existing = await db
      .select({ id: circles.id })
      .from(circles)
      .where(eq(circles.id, item.id))
      .limit(1)
    if (existing[0]) continue
    await db.insert(circles).values({
      id: item.id,
      name: item.name,
      visibility: 'public',
      depth: 1,
      isOfficial: true,
      dormancyDays: null,
    })
  }
}
