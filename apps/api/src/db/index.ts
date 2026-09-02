import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../env'
import * as authSchema from './auth-schema'
import * as domainSchema from './schema'

export const schema = { ...authSchema, ...domainSchema }

export const pool = new Pool({ connectionString: env.DATABASE_URL })
// 空闲连接报错不监听会直接崩进程
pool.on('error', (error) => console.error('[pg]', error))

export const db = drizzle({ client: pool })
