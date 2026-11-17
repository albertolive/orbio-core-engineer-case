import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

const DOT = {
  live: "bg-vivid",
  ok: "bg-lime",
  warn: "bg-warn",
  bad: "bg-destructive",
  idle: "bg-subtle",
} as const

export type DotTone = keyof typeof DOT

// Orbio's "Live" pill: 6px radius, 11.5px text, optional 6px status dot.
export function StatusPill({
  dot,
  mono = false,
  className,
  children,
}: {
  dot?: DotTone
  mono?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[0.72rem] leading-none whitespace-nowrap",
        mono && "font-mono text-[0.6875rem]",
        className
      )}
    >
      {dot && (
        <span aria-hidden className={cn("size-1.5 rounded-full", DOT[dot])} />
      )}
      {children}
    </span>
  )
}
