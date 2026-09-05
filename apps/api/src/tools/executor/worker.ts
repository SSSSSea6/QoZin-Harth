// 在 worker 线程里用 QuickJS 跑工具后端。只用可擦除的 TS 语法，Node 直接加载。
import { readFileSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { getQuickJS, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime } from 'quickjs-emscripten'
import type { BridgeResult, HostToWorker, RunDone, RunLimits, RunRequest, ValidateRequest, WorkerToHost } from './protocol'

const port = parentPort!
const clientSource = readFileSync((workerData as { clientPath: string }).clientPath, 'utf8')

type ErrorCode = NonNullable<RunDone['errorCode']>

class RunFailure extends Error {
  code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

interface PendingCall {
  resolve: (value: { status: number; body: unknown }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface QueuedCall {
  op: string
  args: unknown[]
  resolve: (value: { status: number; body: unknown }) => void
  reject: (error: Error) => void
}

const pendingCalls = new Map<number, PendingCall>()
let nextCallId = 1

function send(message: WorkerToHost): void {
  port.postMessage(message)
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

class Session {
  private runtime: QuickJSRuntime
  private vm: QuickJSContext
  private id: string
  private limits: RunLimits
  private owned: QuickJSHandle[] = []
  private logs = ''
  private logTruncated = false
  private scriptMs = 0
  private segmentStart: number | null = null
  private hostCalls = 0
  private hostBytes = 0
  private posts = 0
  private fatal: RunFailure | null = null
  private failFast: (error: RunFailure) => void = () => {}
  private failed: Promise<never>
  private openDeferreds = 0
  private closed = false
  private queue: QueuedCall[] = []
  private inFlight = 0

  constructor(runtime: QuickJSRuntime, id: string, limits: RunLimits) {
    this.id = id
    this.limits = limits
    this.runtime = runtime
    this.failed = new Promise((_, reject) => {
      this.failFast = reject
    })
    this.failed.catch(() => {})
    runtime.setMemoryLimit(limits.memoryBytes)
    runtime.setMaxStackSize(limits.stackBytes)
    runtime.setInterruptHandler(() => this.scriptElapsed() > limits.scriptMs)
    this.vm = runtime.newContext()
  }

  private scriptElapsed(): number {
    return this.scriptMs + (this.segmentStart === null ? 0 : performance.now() - this.segmentStart)
  }

  // 只有 guest 代码在跑的时间算脚本执行时间，等宿主接口的时间不算
  private segment<T>(fn: () => T): T {
    const nested = this.segmentStart !== null
    if (!nested) this.segmentStart = performance.now()
    try {
      return fn()
    } finally {
      if (!nested && this.segmentStart !== null) {
        this.scriptMs += performance.now() - this.segmentStart
        this.segmentStart = null
      }
    }
  }

  private keep(handle: QuickJSHandle): QuickJSHandle {
    this.owned.push(handle)
    return handle
  }

  private fromJson(value: unknown): QuickJSHandle {
    const json = JSON.stringify(value === undefined ? null : value)
    return this.keep(this.vm.unwrapResult(this.segment(() => this.vm.evalCode(`(${json})`))))
  }

  private describeError(handle: QuickJSHandle): { name: string; message: string; stack: string } {
    const dumped = this.vm.dump(handle) as { name?: string; message?: string; stack?: string } | string
    if (typeof dumped === 'string') return { name: 'Error', message: dumped, stack: '' }
    return {
      name: String(dumped?.name ?? 'Error'),
      message: String(dumped?.message ?? ''),
      stack: String(dumped?.stack ?? '').trim().split('\n')[0] ?? '',
    }
  }

  private failureFrom(handle: QuickJSHandle): RunFailure {
    const err = this.describeError(handle)
    handle.dispose()
    if (this.fatal) return this.fatal
    if (err.name === 'InternalError' && err.message === 'interrupted') {
      return new RunFailure('SCRIPT_TIME', `脚本执行超过 ${this.limits.scriptMs} ms`)
    }
    if (err.name === 'InternalError' && /out of memory|stack overflow/i.test(err.message)) {
      return new RunFailure('MEMORY', err.message)
    }
    const where = err.stack ? `（${err.stack.replace(/^at\s+/, '')}）` : ''
    return new RunFailure('GUEST_ERROR', `${err.name}: ${err.message}${where}`)
  }

  private appendLog(line: string): void {
    if (this.logTruncated) return
    const next = this.logs ? `${this.logs}\n${line}` : line
    if (byteLength(next) > this.limits.logBytes) {
      this.logs = `${this.logs}\n…（日志超过 ${this.limits.logBytes / 1024} KB，已截断）`
      this.logTruncated = true
      return
    }
    this.logs = next
  }

  private installConsole(): void {
    const vm = this.vm
    const consoleObj = this.keep(vm.newObject())
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const fn = this.keep(
        vm.newFunction(level, (...args) => {
          const text = args
            .map((arg) => {
              const value = vm.dump(arg)
              return typeof value === 'string' ? value : JSON.stringify(value)
            })
            .join(' ')
          this.appendLog(level === 'log' || level === 'info' || level === 'debug' ? text : `[${level}] ${text}`)
        }),
      )
      vm.setProp(consoleObj, level, fn)
    }
    vm.setProp(vm.global, 'console', consoleObj)
  }

  private abort(failure: RunFailure): RunFailure {
    if (!this.fatal) {
      this.fatal = failure
      this.failFast(failure)
      for (const item of this.queue.splice(0)) item.reject(failure)
    }
    return this.fatal
  }

  // 同一时刻最多 hostConcurrency 个桥接调用在宿主那边跑，其余在这里排队；致命错误时排队的全部拒绝
  private bridge(op: string, args: unknown[]): Promise<{ status: number; body: unknown }> {
    if (this.fatal) return Promise.reject(this.fatal)
    this.hostCalls += 1
    this.hostBytes += byteLength(JSON.stringify(args))
    if (op === 'posts.create') this.posts += 1
    if (this.hostCalls > this.limits.hostCalls) {
      this.abort(new RunFailure('BUDGET', `一次运行最多调用平台接口 ${this.limits.hostCalls} 次`))
    } else if (this.hostBytes > this.limits.hostBytes) {
      this.abort(new RunFailure('BUDGET', `一次运行与平台交换的数据不能超过 ${this.limits.hostBytes / 1024 / 1024} MB`))
    } else if (this.posts > this.limits.posts) {
      this.abort(new RunFailure('BUDGET', `一次运行最多发 ${this.limits.posts} 帖`))
    }
    if (this.fatal) return Promise.reject(this.fatal)
    return new Promise((resolve, reject) => {
      this.queue.push({ op, args, resolve, reject })
      this.drain()
    })
  }

  private drain(): void {
    while (!this.fatal && this.inFlight < this.limits.hostConcurrency && this.queue.length > 0) {
      this.dispatch(this.queue.shift()!)
    }
  }

  private dispatch(item: QueuedCall): void {
    this.inFlight += 1
    const callId = nextCallId++
    const settle = () => {
      this.inFlight -= 1
      this.drain()
    }
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      settle()
      item.reject(this.abort(new RunFailure('HOST_ERROR', '平台接口没有及时响应')))
    }, this.limits.hostCallMs)
    pendingCalls.set(callId, {
      resolve: (value) => {
        clearTimeout(timer)
        settle()
        this.hostBytes += byteLength(JSON.stringify(value.body ?? null))
        if (this.hostBytes > this.limits.hostBytes) {
          item.reject(this.abort(new RunFailure('BUDGET', `一次运行与平台交换的数据不能超过 ${this.limits.hostBytes / 1024 / 1024} MB`)))
          return
        }
        item.resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        settle()
        item.reject(error)
      },
      timer,
    })
    send({ type: 'bridge', id: this.id, callId, op: item.op as never, args: item.args })
  }

  private installHarth(context: RunRequest['context']): QuickJSHandle {
    const vm = this.vm
    const transport = this.keep(
      vm.newFunction('transport', (opHandle, argsHandle) => {
        const op = vm.getString(opHandle)
        const args = (vm.dump(argsHandle) as unknown[]) ?? []
        const deferred = vm.newPromise()
        this.openDeferreds += 1
        this.bridge(op, args).then(
          (value) => {
            if (this.closed) return
            deferred.resolve(this.fromJson(value))
          },
          (error: unknown) => {
            if (this.closed) return
            const message = error instanceof Error ? error.message : String(error)
            const errorHandle = this.keep(vm.unwrapResult(this.segment(() => vm.evalCode(`new Error(${JSON.stringify(message)})`))))
            deferred.reject(errorHandle)
          },
        )
        deferred.settled.then(() => {
          this.openDeferreds -= 1
          if (this.closed) return
          deferred.dispose()
          this.pump()
        })
        return deferred.handle
      }),
    )
    const clientNs = this.keep(this.vm.unwrapResult(this.segment(() => vm.evalCode(clientSource, 'harth-client.js', { type: 'module' }))))
    const factory = this.keep(vm.getProp(clientNs, 'createHarthApi'))
    const harth = this.keep(vm.unwrapResult(this.segment(() => vm.callFunction(factory, vm.undefined, transport))))
    for (const [key, value] of Object.entries(context)) {
      vm.setProp(harth, key, this.fromJson(value))
    }
    return harth
  }

  private pump(): void {
    if (this.fatal) return
    const result = this.segment(() => this.runtime.executePendingJobs())
    if (result.error) this.abort(this.failureFrom(result.error))
  }

  private loadActions(code: string, file: string): QuickJSHandle {
    const evaluated = this.segment(() => this.vm.evalCode(code, file, { type: 'module' }))
    if (evaluated.error) throw this.failureFrom(evaluated.error)
    const ns = this.keep(evaluated.value)
    const actions = this.keep(this.vm.getProp(ns, 'default'))
    if (this.vm.typeof(actions) !== 'object' || this.vm.dump(actions) === null) {
      throw new RunFailure('ACTION_MISSING', `${file} 需要默认导出一个对象，键是动作名`)
    }
    return actions
  }

  validate(req: ValidateRequest): string | null {
    try {
      const actions = this.loadActions(req.code, req.file)
      const missing = req.actions.filter((name) => {
        const fn = this.keep(this.vm.getProp(actions, name))
        return this.vm.typeof(fn) !== 'function'
      })
      if (missing.length > 0) return `后端里没有这些动作：${missing.join('、')}`
      return null
    } catch (err) {
      return err instanceof RunFailure ? err.message : String(err)
    }
  }

  async run(req: RunRequest): Promise<{ result: unknown }> {
    this.installConsole()
    const harth = this.installHarth(req.context)
    const actions = this.loadActions(req.code, req.file)
    const fn = this.keep(this.vm.getProp(actions, req.action))
    if (this.vm.typeof(fn) !== 'function') {
      throw new RunFailure('ACTION_MISSING', `后端里没有动作 ${req.action}`)
    }
    const input = this.fromJson(req.input)
    const called = this.segment(() => this.vm.callFunction(fn, this.vm.undefined, harth, input))
    if (called.error) throw this.failureFrom(called.error)
    const returned = this.keep(called.value)
    const settledPromise = this.vm.resolvePromise(returned)
    this.pump()
    const settled = await Promise.race([settledPromise, this.failed])
    if (this.fatal) throw this.fatal
    if (settled.error) throw this.failureFrom(settled.error)
    const value = this.keep(settled.value)
    const stringify = this.keep(this.vm.unwrapResult(this.segment(() => this.vm.evalCode('(v) => JSON.stringify(v === undefined ? null : v)'))))
    const serialized = this.segment(() => this.vm.callFunction(stringify, this.vm.undefined, value))
    if (serialized.error) throw this.failureFrom(serialized.error)
    const text = this.vm.dump(this.keep(serialized.value)) as string | undefined
    if (text !== undefined && byteLength(text) > this.limits.resultBytes) {
      throw new RunFailure('BUDGET', `返回值不能超过 ${this.limits.resultBytes / 1024} KB`)
    }
    return { result: text === undefined ? null : JSON.parse(text) }
  }

  get output(): { logs: string; scriptMs: number } {
    return { logs: this.logs, scriptMs: Math.round(this.scriptMs) }
  }

  // 还有挂着的桥接调用时 runtime 释放不干净（QuickJS 会断言 abort），这时只清理宿主侧并告诉宿主换 worker
  dispose(): boolean {
    this.closed = true
    for (const call of pendingCalls.values()) clearTimeout(call.timer)
    pendingCalls.clear()
    if (this.fatal || this.openDeferreds > 0) return false
    for (const handle of this.owned.reverse()) handle.dispose()
    this.owned = []
    this.vm.dispose()
    this.runtime.dispose()
    return true
  }
}

async function handleRun(req: RunRequest): Promise<void> {
  const QuickJS = await getQuickJS()
  const session = new Session(QuickJS.newRuntime(), req.id, req.limits)
  let done: RunDone
  try {
    const { result } = await session.run(req)
    done = { type: 'done', id: req.id, ok: true, result, ...session.output }
  } catch (err) {
    const failure = err instanceof RunFailure ? err : new RunFailure('HOST_ERROR', err instanceof Error ? err.message : String(err))
    done = { type: 'done', id: req.id, ok: false, errorCode: failure.code, error: failure.message, ...session.output }
  }
  done.dirty = !session.dispose()
  send(done)
}

async function handleValidate(req: ValidateRequest): Promise<void> {
  const QuickJS = await getQuickJS()
  const session = new Session(QuickJS.newRuntime(), req.id, req.limits)
  const error = session.validate(req)
  const dirty = !session.dispose()
  send({ type: 'done', id: req.id, ok: error === null, error: error ?? undefined, logs: '', scriptMs: 0, dirty })
}

port.on('message', (message: HostToWorker) => {
  if (message.type === 'run') void handleRun(message)
  else if (message.type === 'validate') void handleValidate(message)
  else if (message.type === 'bridge-result') {
    const call = pendingCalls.get(message.callId)
    if (!call) return
    pendingCalls.delete(message.callId)
    call.resolve({ status: (message as BridgeResult).status, body: message.body })
  }
})
