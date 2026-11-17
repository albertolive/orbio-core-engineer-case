import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export interface SourceTarget {
  sessionId: string
  turnId: string
  chunkId: string
}

export interface SourceFocus extends SourceTarget {
  /** Bumps on every click so the highlight replays even for the same chunk. */
  nonce: number
}

interface SourceFocusValue {
  focus: SourceFocus | null
  cite: (target: SourceTarget) => void
}

const SourceFocusContext = createContext<SourceFocusValue>({
  focus: null,
  cite: () => {},
})

export function SourceFocusProvider({
  onCite,
  children,
}: {
  onCite?: () => void
  children: ReactNode
}) {
  const [focus, setFocus] = useState<SourceFocus | null>(null)
  const cite = useCallback(
    (target: SourceTarget) => {
      setFocus((prev) => ({ ...target, nonce: (prev?.nonce ?? 0) + 1 }))
      onCite?.()
    },
    [onCite]
  )
  const value = useMemo(() => ({ focus, cite }), [focus, cite])
  return <SourceFocusContext value={value}>{children}</SourceFocusContext>
}

export const useSourceFocus = (): SourceFocusValue =>
  useContext(SourceFocusContext)

export const chunkDomId = (turnId: string, chunkId: string): string =>
  `source-${turnId}-${chunkId}`.replace(/[^a-zA-Z0-9_-]/g, "_")
