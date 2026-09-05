import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { TOOL_RUN_LIMITS, type ToolApiOp, type ToolRunErrorCode } from '@harth/shared'
import type { GuestContext, HostToWorker, RunLimits, WorkerToHost } from './protocol'

const CLIENT_PATH = fileURLToPath(new URL('../../../../../packages/sdk/dist/client.js', import.meta.url))
const WORKER_URL = new URL('./worker.ts', import.meta.url)

export const RUN_LIMITS: RunLimits = {
  memoryBytes: TOOL_RUN_LIMITS.memoryBytes,
  stackBytes: TOOL_RUN_LIMITS.stackBytes,
  scriptMs: TOOL_RUN_LIMITS.scriptMs,
  hostCallMs: TOOL_RUN_LIMITS.hostCallMs,
  hostCalls: TOOL_RUN_LIMITS.hostCalls,
  hostBytes: TOOL_RUN_LIMITS.hostBytes,
  posts: TOOL_RUN_LIMITS.posts,
  logBytes: TOOL_RUN_LIMITS.logBytes,
  resultBytes: TOOL_RUN_LIMITS.resultBytes,
}

export type Bridge = (op: ToolApiOp, args: unknown[]) => Promise<{ status: number; body: unknown }>

export interface ExecuteJob {
  code: string
  file: string
  action: string
  input: unknown
  context: GuestContext
  bridge: Bridge
}

export interface ExecuteOutcome {
  ok: boolean
  result?: unknown
  errorCode?: ToolRunErrorCode
  error?: string
  logs: string
  scriptMs: number
  durationMs: number
}

interface Current {
  id: string
  bridge: Bridge | null
  finish: (outcome: ExecuteOutcome) => void
  startedAt: number
  timer: ReturnType<typeof setTimeout>
}

// 一个 worker 同一时刻只跑一个运行；超时直接 terminate，下次用新 worker
class Slot {
  private worker: Worker | null = null
  current: Current | null = null

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(WORKER_URL, {
      workerData: { clientPath: CLIENT_PATH },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    })
    worker.on('message', (message: WorkerToHost) => {
      if (this.worker === worker) this.onMessage(message)
    })
    worker.on('error', (err: Error) => {
      if (this.worker === worker) this.crash(`执行器出错：${err.message}`)
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = null
      if (code !== 0) this.crash(`执行器退出（${code}）`)
    })
    this.worker = worker
    return worker
  }

  private crash(message: string): void {
    this.worker = null
    const current = this.current
    if (!current) return
    this.current = null
    clearTimeout(current.timer)
    current.finish({ ok: false, errorCode: 'HOST_ERROR', error: message, logs: '', scriptMs: 0, durationMs: Date.now() - current.startedAt })
  }

  private onMessage(message: WorkerToHost): void {
    const current = this.current
    if (!current || message.id !== current.id) return
    if (message.type === 'bridge') {
      const reply = (status: number, body: unknown) => {
        if (this.current !== current) return
        this.post({ type: 'bridge-result', id: current.id, callId: message.callId, status, body })
      }
      if (!current.bridge) {
        reply(400, { error: '这次运行不能访问平台接口' })
        return
      }
      current.bridge(message.op, message.args).then(
        (res) => reply(res.status, res.body),
        (err: unknown) => reply(500, { error: err instanceof Error ? err.message : String(err) }),
      )
      return
    }
    this.current = null
    clearTimeout(current.timer)
    current.finish({
      ok: message.ok,
      result: message.result,
      errorCode: message.errorCode,
      error: message.error,
      logs: message.logs,
      scriptMs: message.scriptMs,
      durationMs: Date.now() - current.startedAt,
    })
  }

  private post(message: HostToWorker): void {
    this.ensureWorker().postMessage(message)
  }

  execute(id: string, message: HostToWorker, bridge: Bridge | null, totalMs: number): Promise<ExecuteOutcome> {
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = setTimeout(() => {
        const current = this.current
        if (!current || current.id !== id) return
        this.current = null
        const worker = this.worker
        this.worker = null
        void worker?.terminate()
        resolve({ ok: false, errorCode: 'TIMEOUT', error: `运行超过 ${totalMs / 1000} 秒`, logs: '', scriptMs: 0, durationMs: Date.now() - startedAt })
      }, totalMs)
      this.current = { id, bridge, finish: resolve, startedAt, timer }
      this.post(message)
    })
  }
}

const slots = Array.from({ length: TOOL_RUN_LIMITS.concurrency }, () => new Slot())
const busy = new Set<Slot>()
const waiters: ((slot: Slot) => void)[] = []
let seq = 0

async function withSlot<T>(fn: (slot: Slot) => Promise<T>): Promise<T> {
  const free = slots.find((s) => !busy.has(s))
  const slot = free ?? (await new Promise<Slot>((resolve) => waiters.push(resolve)))
  busy.add(slot)
  try {
    return await fn(slot)
  } finally {
    const next = waiters.shift()
    if (next) next(slot)
    else busy.delete(slot)
  }
}

export function executeAction(job: ExecuteJob): Promise<ExecuteOutcome> {
  const id = `run-${++seq}`
  return withSlot((slot) =>
    slot.execute(
      id,
      { type: 'run', id, code: job.code, file: job.file, action: job.action, input: job.input, context: job.context, limits: RUN_LIMITS },
      job.bridge,
      TOOL_RUN_LIMITS.totalMs,
    ),
  )
}

// 发布时在沙箱里求值：默认导出是对象、声明的动作都是函数
export async function validateBackend(code: string, file: string, actions: string[]): Promise<string | null> {
  const id = `validate-${++seq}`
  const outcome = await withSlot((slot) =>
    slot.execute(id, { type: 'validate', id, code, file, actions, limits: RUN_LIMITS }, null, TOOL_RUN_LIMITS.totalMs),
  )
  return outcome.ok ? null : (outcome.error ?? '后端代码无法加载')
}
