import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))

export async function migrateDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_DIR })
  } finally {
    await pool.end()
  }
}
