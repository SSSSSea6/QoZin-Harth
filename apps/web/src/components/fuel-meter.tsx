import { formatFuel } from '@harth/shared'

// 本月燃料：已用 / 额度，一条细进度条；预留中的算在已用里
export function FuelMeter({
  usage,
}: {
  usage: { month: string; used: number; reserved: number; allowance: number; storageBytes: number }
}) {
  const spent = usage.used + usage.reserved
  const ratio = usage.allowance > 0 ? Math.min(1, spent / usage.allowance) : 0
  const exhausted = spent >= usage.allowance
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {formatFuel(spent)} / {formatFuel(usage.allowance)}
        </span>
        <span className="text-[13px] text-muted-foreground">{usage.month}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={exhausted ? 'h-full bg-destructive' : 'h-full bg-foreground-2'} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        {exhausted ? '本月燃料已用完，后端运行和写入停到下个月，读取照常。' : `存储占用 ${formatBytes(usage.storageBytes)}。`}
      </p>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
