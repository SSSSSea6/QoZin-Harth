import type { auth } from './auth'

type SessionData = typeof auth.$Infer.Session

export type AppEnv = {
  Variables: {
    user: SessionData['user'] | null
    session: SessionData['session'] | null
  }
}

// requireAuth 之后 user 一定存在
export type AuthedEnv = {
  Variables: {
    user: SessionData['user']
    session: SessionData['session']
  }
}
