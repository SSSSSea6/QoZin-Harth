export const TOOL_SCHEDULE_TZ = 'Asia/Shanghai'

const FIELD = String.raw`(?:\*|\d{1,2}(?:-\d{1,2})?)(?:/\d{1,2})?(?:,(?:\*|\d{1,2}(?:-\d{1,2})?)(?:/\d{1,2})?)*`

// 五段、只有数字与 * , - /；名字、别名、秒字段一律不收
export const CRON_PATTERN = new RegExp(`^${FIELD}(?: ${FIELD}){4}$`)

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function listOf(field: string): number[] | null {
  if (!/^\d{1,2}(?:,\d{1,2})*$/.test(field)) return null
  return field.split(',').map(Number)
}

function every(field: string): number | null {
  const m = /^\*\/(\d{1,2})$/.exec(field)
  return m ? Number(m[1]) : null
}

// 常见形态翻成人话，翻不了就返回 null，由调用方显示原式
export function describeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string]
  if (month !== '*') return null

  const minutes = listOf(minute)
  const hours = listOf(hour)
  if (minutes?.length === 1 && hours?.length === 1 && dom === '*') {
    const time = `${pad(hours[0]!)}:${pad(minutes[0]!)}`
    if (dow === '*') return `每天 ${time}`
    if (dow === '1-5') return `每个工作日 ${time}`
    const days = listOf(dow)
    if (days && days.every((d) => d >= 0 && d <= 7)) {
      return `每周${days.map((d) => WEEKDAYS[d % 7]).join('、')} ${time}`
    }
    return null
  }
  if (minutes?.length === 1 && hours?.length === 1 && dow === '*') {
    const days = listOf(dom)
    if (days && days.every((d) => d >= 1 && d <= 31)) {
      return `每月 ${days.join('、')} 日 ${pad(hours[0]!)}:${pad(minutes[0]!)}`
    }
    return null
  }
  if (dom !== '*' || dow !== '*') return null
  if (minutes?.length === 1 && hour === '*') return `每小时第 ${minutes[0]} 分`
  const everyHours = every(hour)
  if (minutes?.length === 1 && everyHours) return `每 ${everyHours} 小时（第 ${minutes[0]} 分）`
  const everyMinutes = every(minute)
  if (everyMinutes && hour === '*') return `每 ${everyMinutes} 分钟`
  return null
}
