import { DownloadIcon } from "lucide-react"

import { HandoffCard } from "@/components/console/handoff-card"
import { LiveState } from "@/components/console/live-state"
import { SessionJson } from "@/components/console/session-json"
import { StatusPill, type DotTone } from "@/components/console/status-pill"
import { TicketCard } from "@/components/console/ticket-card"
import { Button } from "@/components/ui/button"
import { useSupport } from "@/hooks/use-support"
import type { TtsInfo } from "@/lib/support-client"
import type { ConversationSession, Phase } from "@/lib/types"
import { cn } from "@/lib/utils"

const PHASE: Record<Phase, { label: string; dot: DotTone }> = {
  collecting: { label: "Collecting", dot: "live" },
  confirming: { label: "Confirming", dot: "warn" },
  completed: { label: "Completed", dot: "ok" },
  escalated: { label: "Escalated", dot: "bad" },
  canceled: { label: "Canceled", dot: "idle" },
}

function ttsLabel({ status, provider, degraded }: TtsInfo): string {
  if (status === "checking") return "TTS · checking"
  if (status === "ok") return `TTS · ${provider}`
  return `TTS · browser (${degraded ?? "fallback"})`
}

function downloadSession(session: ConversationSession): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], {
    type: "application/json",
  })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `novamart-session-${session.session_id.slice(0, 8)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

export function ConsolePanel({ className }: { className?: string }) {
  const { session, tts } = useSupport()

  return (
    <aside
      aria-label="Specialist console"
      className={cn(
        "dark flex min-h-0 flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-panel",
        className
      )}
    >
      <header className="flex flex-col gap-3 border-b px-4 py-4 md:px-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8125rem] font-medium text-subtle">
            Specialist console
          </p>
          <Button
            variant="outline"
            size="sm"
            className="max-md:h-9"
            disabled={!session}
            onClick={() => session && downloadSession(session)}
          >
            <DownloadIcon data-icon="inline-start" />
            Download JSON
          </Button>
        </div>
        <h2 className="font-heading text-2xl leading-[1.1] font-semibold tracking-display">
          Agents act. <span className="text-emphasis">People decide.</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {session && (
            <StatusPill dot={PHASE[session.phase].dot}>
              {PHASE[session.phase].label}
            </StatusPill>
          )}
          <StatusPill
            mono
            className={cn(
              tts.status === "fallback" && "border-warn/60 text-warn"
            )}
          >
            {ttsLabel(tts)}
          </StatusPill>
        </div>
      </header>

      <div
        key={session?.session_id}
        className="min-h-0 flex-1 scroll-thin overflow-y-auto p-3 [--card-spacing:--spacing(4)] md:p-4 md:[--card-spacing:--spacing(5)]"
      >
        {session ? (
          <div className="flex flex-col gap-3">
            <TicketCard session={session} />
            <HandoffCard session={session} />
            <LiveState session={session} tts={tts} />
            <SessionJson session={session} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Waiting for a session…
          </p>
        )}
      </div>
    </aside>
  )
}
