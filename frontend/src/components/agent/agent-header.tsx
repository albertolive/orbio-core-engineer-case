import { useReducedMotion } from "motion/react"
import { FileTextIcon, RotateCcwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ShimmeringText } from "@/components/ui/shimmering-text"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { supportClient, useSupport } from "@/hooks/use-support"
import {
  STATUS_LABEL,
  agentStatus,
  isActive,
  type AgentStatus,
} from "@/lib/agent-status"
import { LANGUAGE_OPTIONS } from "@/lib/languages"
import type { Playback } from "@/lib/support-client"
import type { Language } from "@/lib/types"
import { cn } from "@/lib/utils"

function statusText(status: AgentStatus, playback: Playback | null): string {
  if (status === "speaking") {
    return `Speaking · ${playback?.mode === "browser" ? "browser voice" : "ElevenLabs"}`
  }
  if (status === "escalated") return "Escalated · human specialist"
  return isActive(status) ? `${STATUS_LABEL[status]}…` : STATUS_LABEL[status]
}

function StatusText({
  status,
  playback,
}: {
  status: AgentStatus
  playback: Playback | null
}) {
  const reduceMotion = useReducedMotion()
  const label = statusText(status, playback)
  return (
    <p role="status" className="flex items-center gap-2 text-xs font-medium">
      <span
        aria-hidden
        className={cn(
          "size-[7px] shrink-0 rounded-full transition-colors duration-300",
          status === "escalated"
            ? "bg-warn"
            : isActive(status)
              ? "status-pulse bg-vivid"
              : "bg-ink/20"
        )}
      />
      {isActive(status) && !reduceMotion ? (
        <ShimmeringText
          key={label}
          text={label}
          duration={1.8}
          color="var(--lime)"
          shimmerColor="var(--cream-50)"
        />
      ) : (
        <span
          className={cn(
            isActive(status) && "text-lime",
            status === "escalated" && "text-warn",
            status === "idle" && "text-muted-foreground"
          )}
        >
          {label}
        </span>
      )}
    </p>
  )
}

// Orbio's agent card (.ra): light while Nova stands by, deep green while "on call".
function AgentCard({
  status,
  playback,
}: {
  status: AgentStatus
  playback: Playback | null
}) {
  const on = isActive(status)
  return (
    <div
      className={cn(
        "surface-flip flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border p-3",
        on
          ? "dark border-background bg-background text-foreground shadow-card-on"
          : "bg-card shadow-card",
        status === "escalated" && "border-warn/50 bg-warn/10"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-md border font-heading text-[0.9375rem] font-semibold",
          on
            ? "border-[#ffffff47] bg-[#ffffff1f] text-white ring-2 ring-lime ring-offset-2 ring-offset-background"
            : "text-foreground"
        )}
      >
        N
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-heading text-[1.0625rem] leading-tight font-semibold tracking-[-0.02em]">
          Nova{" "}
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>{" "}
          <span className="text-[0.8125rem] font-medium text-muted-foreground">
            AI Support Specialist
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          You&rsquo;re talking to an AI. A person is one request away.
        </p>
      </div>
      <div className="max-sm:basis-full max-sm:pl-[3.25rem] sm:ml-auto">
        <StatusText status={status} playback={playback} />
      </div>
    </div>
  )
}

export function AgentHeader() {
  const state = useSupport()
  const { session, creating, busy, voiceReply, startLanguage } = state

  return (
    <header className="flex flex-col gap-2.5 border-b px-4 pt-3 pb-3 md:gap-3 md:px-5 md:pt-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold tracking-display">
          NovaMart <span className="text-emphasis">Support</span>
        </h1>
        {session && (
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[0.6875rem] text-subtle sm:inline">
              Session {session.session_id.slice(0, 8)}
            </span>
            <Badge
              variant="outline"
              className="font-mono"
              aria-label={`Session language ${session.language}`}
            >
              {session.language.toUpperCase()}
            </Badge>
          </div>
        )}
      </div>

      <AgentCard status={agentStatus(state)} playback={state.playback} />

      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3">
        <div className="flex items-center justify-between gap-3 md:contents">
          <div className="flex items-center gap-2">
            <span
              id="start-language-label"
              className="text-xs text-muted-foreground max-md:sr-only"
            >
              Start in
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={startLanguage}
              onValueChange={(value) => {
                if (value) supportClient.setStartLanguage(value as Language)
              }}
              aria-labelledby="start-language-label"
            >
              {LANGUAGE_OPTIONS.map(({ value, label }) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="max-md:h-9"
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <label className="flex items-center gap-2 text-sm max-md:min-h-9 md:order-last md:ml-auto">
            Voice reply
            <Switch
              checked={voiceReply}
              onCheckedChange={(checked) =>
                supportClient.setVoiceReply(checked)
              }
            />
          </label>
        </div>
        <div className="flex gap-2 md:contents">
          <Button
            variant="outline"
            size="sm"
            className="max-md:h-9 max-md:flex-1"
            disabled={creating}
            onClick={() => void supportClient.newSession()}
          >
            <RotateCcwIcon data-icon="inline-start" />
            New session
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="max-md:h-9 max-md:flex-1"
            disabled={!session || busy !== null}
            onClick={() => void supportClient.finalize()}
          >
            <FileTextIcon data-icon="inline-start" />
            Generate summary
          </Button>
        </div>
      </div>
    </header>
  )
}
