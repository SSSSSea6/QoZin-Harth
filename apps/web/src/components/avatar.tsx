import { minidenticon } from 'minidenticons'
import { cn } from '@/lib/utils'

// 由 id 生成的 identicon
export function Avatar({
  seed,
  size = 32,
  className,
}: {
  seed: string
  size?: number
  className?: string
}) {
  const svg = minidenticon(seed, 55, 45)
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={cn('shrink-0 rounded-md bg-muted', className)}
      style={{ width: size, height: size }}
    />
  )
}
