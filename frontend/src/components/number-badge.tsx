import { cn } from "@/lib/utils"

const TONES = {
  solid: "bg-ink text-lime ring-1 ring-border",
  pending: "bg-ink text-subtle ring-1 ring-border",
  danger: "bg-destructive/15 text-destructive ring-1 ring-destructive/50",
} as const

// Orbio's numbered tile ("01"): --ink square, 6px radius, Geist digits in
// --lime. Decorative: the list or the surrounding label carries the meaning.
export function NumberBadge({
  n,
  tone = "solid",
  className,
}: {
  n: number
  tone?: keyof typeof TONES
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-6 shrink-0 place-items-center rounded-md font-heading text-xs font-semibold tabular-nums transition-colors duration-300",
        TONES[tone],
        className
      )}
    >
      {String(n).padStart(2, "0")}
    </span>
  )
}
