'use client'

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating} 分`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-3.5',
            n <= rating
              ? 'fill-primary text-primary'
              : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  )
}

export function StarInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="评分">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} 分`}
          onClick={() => onChange(n)}
          className="p-0.5"
        >
          <Star
            aria-hidden
            className={cn(
              'size-6 transition-colors',
              n <= value ? 'fill-primary text-primary' : 'text-muted-foreground/40',
            )}
          />
        </button>
      ))}
    </div>
  )
}
