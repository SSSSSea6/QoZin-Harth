import { customSessionClient, deviceAuthorizationClient, phoneNumberClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from 'api/src/auth'
import { API_URL } from './api'

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [deviceAuthorizationClient(), phoneNumberClient(), customSessionClient<typeof auth>()],
})

export const { useSession, signIn, signUp, signOut } = authClient
