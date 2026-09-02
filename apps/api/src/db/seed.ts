import { env } from '../env'
import { db } from './index'
import { circles } from './schema'

export async function seed(): Promise<void> {
  await db
    .insert(circles)
    .values({
      id: env.TOP_CIRCLE.id,
      name: env.TOP_CIRCLE.name,
      visibility: 'public',
      depth: 1,
      isOfficial: true,
      dormancyDays: null,
    })
    .onConflictDoNothing()
}
