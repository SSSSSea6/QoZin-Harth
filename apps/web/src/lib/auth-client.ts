import { customSessionClient, deviceAuthorizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from 'api/src/auth'
import { API_URL } from './api'

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [deviceAuthorizationClient(), customSessionClient<typeof auth>()],
})

export const { useSession, signIn, signUp, signOut } = authClient
