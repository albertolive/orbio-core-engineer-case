import type { ReactNode } from "react"

// Orbio's trust-center group label (.tc-sep): a 12.5px label, then a hairline
// that runs to the edge. `aside` sits after the hairline.
export function SectionLabel({
  children,
  aside,
}: {
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-[0.78rem] font-medium">{children}</h3>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {aside}
    </div>
  )
}
