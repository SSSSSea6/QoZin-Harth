import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: ['./src/db/schema.ts', './src/db/auth-schema.ts'],
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
