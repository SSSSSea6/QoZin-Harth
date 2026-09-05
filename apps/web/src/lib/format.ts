export function formatPrice(priceFen: number): string {
  if (priceFen === 0) return '免费赠送'
  const yuan = priceFen / 100
  return `¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(2)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function timeAgo(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const diff = Date.now() - date.getTime()
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  if (diff < 30 * 24 * 60 * minute) {
    return `${Math.floor(diff / (24 * 60 * minute))} 天前`
  }
  return date.toLocaleDateString('zh-CN')
}

export function daysUntil(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const days = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60_000))
  return days <= 0 ? '今天' : `${days} 天后`
}
