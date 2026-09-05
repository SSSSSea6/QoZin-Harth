import { betterAuth } from 'better-auth'
import { bearer, customSession, deviceAuthorization } from 'better-auth/plugins'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { db } from './db'
import * as authSchema from './db/auth-schema'
import { env, isAdmin } from './env'

export const CLI_CLIENT_ID = 'harth-cli'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true },
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_URL],
  plugins: [
    bearer(),
    deviceAuthorization({
      verificationUri: `${env.WEB_URL}/device`,
      validateClient: (clientId) => clientId === CLI_CLIENT_ID,
    }),
    customSession(async ({ user, session }) => ({
      user: { ...user, isAdmin: isAdmin(user) },
      session,
    })),
  ],
})
