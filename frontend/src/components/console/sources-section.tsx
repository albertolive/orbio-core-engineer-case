import { useEffect } from "react"
import { useReducedMotion } from "motion/react"

import { SectionLabel } from "@/components/console/section-label"
import { chunkDomId, useSourceFocus } from "@/components/source-focus"
import { NumberBadge } from "@/components/number-badge"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  latestTurn,
  type ConversationSession,
  type ConversationTurn,
  type RetrievedChunk,
} from "@/lib/types"
import { cn } from "@/lib/utils"

function ChunkCard({
  n,
  turn,
  chunk,
  cited,
  active,
}: {
  n: number
  turn: ConversationTurn
  chunk: RetrievedChunk
  cited: boolean
  active: boolean
}) {
  return (
    <li
      id={chunkDomId(turn.turn_id, chunk.chunk_id)}
      data-active={active}
      className={cn(
        "flex scroll-mt-4 flex-col gap-2 rounded-md border p-3 transition-colors duration-300",
        "data-[active=true]:border-signal data-[active=true]:bg-signal/10",
        active && "source-ping"
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <NumberBadge n={n} className="mt-0.5" />
        <div className="min-w-0 flex-1 basis-40">
          <p className="font-heading text-sm font-semibold tracking-[-0.01em]">
            {chunk.title}
          </p>
          <p className="truncate font-mono text-[0.6875rem] text-subtle">
            {chunk.chunk_id}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:pl-9">
          <span className="flex items-center gap-2">
            <Progress
              value={chunk.score * 100}
              aria-label="Cosine score"
              className="h-1 w-14"
            />
            <span className="text-xs tabular-nums">
              score {chunk.score.toFixed(2)}
            </span>
          </span>
          {cited && (
            <Badge variant="outline" className="border-signal/60 text-signal">
              cited
            </Badge>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {chunk.content}
      </p>
    </li>
  )
}

export function SourcesSection({ session }: { session: ConversationSession }) {
  const { focus } = useSourceFocus()
  const reduceMotion = useReducedMotion()
  const scoped = focus?.sessionId === session.session_id ? focus : null
  const turn =
    session.turns.find((t) => t.turn_id === scoped?.turnId) ??
    latestTurn(session)
  const chunks = turn?.retrieved_chunks ?? []

  useEffect(() => {
    if (!scoped) return
    document
      .getElementById(chunkDomId(scoped.turnId, scoped.chunkId))
      ?.scrollIntoView({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      })
  }, [scoped, reduceMotion])

  return (
    <div className="flex flex-col gap-3 px-(--card-spacing)">
      <SectionLabel
        aside={
          turn &&
          chunks.length > 0 && (
            <span className="text-[0.6875rem] text-subtle tabular-nums">
              turn {turn.turn_id}
            </span>
          )
        }
      >
        Retrieved sources
      </SectionLabel>
      {turn && chunks.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            Every claim shows its source. Click a source badge in the
            conversation to find it here.
          </p>
          <ul className="flex flex-col gap-2">
            {chunks.map((chunk, index) => (
              <ChunkCard
                key={`${chunk.chunk_id}-${scoped?.chunkId === chunk.chunk_id ? scoped.nonce : 0}`}
                n={index + 1}
                turn={turn}
                chunk={chunk}
                cited={turn.cited_kb_ids.includes(chunk.chunk_id)}
                active={
                  scoped?.turnId === turn.turn_id &&
                  scoped.chunkId === chunk.chunk_id
                }
              />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No KB sections retrieved on this turn.
        </p>
      )}
    </div>
  )
}
