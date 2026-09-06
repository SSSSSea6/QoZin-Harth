import { cn } from '@/lib/utils'

// 没有上传头像，用名字首字加按 id 固定的色相；人是圆的，圈子与工具是方的
const HUES = [25, 55, 145, 195, 230, 270, 300, 340]

function hueOf(seed: string): number {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return HUES[hash % HUES.length]!
}

function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? '·'
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

export function Avatar({
  seed,
  name,
  size = 32,
  shape = 'circle',
  className,
}: {
  seed: string
  name: string
  size?: number
  shape?: 'circle' | 'square'
  className?: string
}) {
  const hue = hueOf(seed)
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold leading-none',
        shape === 'circle' ? 'rounded-full' : 'rounded-md',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: `oklch(0.42 0.09 ${hue})`,
        color: `oklch(0.97 0.02 ${hue})`,
      }}
    >
      {initialOf(name)}
    </span>
  )
}
