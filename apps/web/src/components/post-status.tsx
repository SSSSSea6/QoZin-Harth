import { Badge } from '@/components/ui/badge'

const LABELS = {
  open: null,
  matched: '进行中',
  completed: '已完成',
  cancelled: '已取消',
} as const

export function PostStatusBadge({
  status,
}: {
  status: keyof typeof LABELS
}) {
  const label = LABELS[status]
  if (!label) return null
  return (
    <Badge
      variant={status === 'completed' ? 'secondary' : 'outline'}
      className={status === 'cancelled' ? 'text-muted-foreground' : undefined}
    >
      {label}
    </Badge>
  )
}
