import { deviceAuthorizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { API_URL } from './api'

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [deviceAuthorizationClient()],
})

export const { useSession, signIn, signUp, signOut } = authClient
