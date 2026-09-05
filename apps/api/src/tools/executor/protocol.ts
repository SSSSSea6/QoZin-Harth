import type { ToolApiOp, ToolRunErrorCode, ToolRunTrigger } from '@harth/shared'

export interface GuestContext {
  user: { id: string; name: string } | null
  circle: { id: string; name: string }
  tool: { slug: string; name: string; version: string }
  scopes: string[]
  trigger: ToolRunTrigger
}

export interface RunLimits {
  memoryBytes: number
  stackBytes: number
  scriptMs: number
  hostCallMs: number
  hostCalls: number
  hostConcurrency: number
  hostBytes: number
  posts: number
  logBytes: number
  resultBytes: number
}

export interface RunRequest {
  type: 'run'
  id: string
  code: string
  file: string
  action: string
  input: unknown
  context: GuestContext
  limits: RunLimits
}

export interface ValidateRequest {
  type: 'validate'
  id: string
  code: string
  file: string
  actions: string[]
  limits: RunLimits
}

export interface BridgeResult {
  type: 'bridge-result'
  id: string
  callId: number
  status: number
  body: unknown
}

export type HostToWorker = RunRequest | ValidateRequest | BridgeResult

export interface BridgeCall {
  type: 'bridge'
  id: string
  callId: number
  op: ToolApiOp
  args: unknown[]
}

// dirty：runtime 没能干净释放（还有挂着的桥接调用），宿主应换一个 worker
export interface RunDone {
  type: 'done'
  id: string
  ok: boolean
  result?: unknown
  errorCode?: ToolRunErrorCode
  error?: string
  logs: string
  scriptMs: number
  dirty?: boolean
}

export type WorkerToHost = BridgeCall | RunDone
