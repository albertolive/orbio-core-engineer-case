import { useMemo, useSyncExternalStore } from "react"
import { useReducedMotion } from "motion/react"
import { SquareIcon } from "lucide-react"

import { BarVisualizer, type AgentState } from "@/components/ui/bar-visualizer"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  ScrubBarContainer,
  ScrubBarProgress,
  ScrubBarThumb,
  ScrubBarTimeLabel,
  ScrubBarTrack,
} from "@/components/ui/scrub-bar"
import { isActive, type AgentStatus } from "@/lib/agent-status"
import { supportClient } from "@/hooks/use-support"
import type { Playback } from "@/lib/support-client"
import { cn } from "@/lib/utils"

const VISUALIZER_STATE: Partial<Record<AgentStatus, AgentState>> = {
  listening: "listening",
  transcribing: "initializing",
  thinking: "thinking",
  speaking: "speaking",
}

// Frame-rate subscription so the scrubber moves smoothly (timeupdate fires ~4x/s).
const everyFrame = (notify: () => void) => {
  let id = requestAnimationFrame(function tick() {
    notify()
    id = requestAnimationFrame(tick)
  })
  return () => cancelAnimationFrame(id)
}

function PlaybackScrubber({ audio }: { audio: HTMLAudioElement }) {
  const subscribeMetadata = useMemo(
    () => (notify: () => void) => {
      audio.addEventListener("loadedmetadata", notify)
      audio.addEventListener("durationchange", notify)
      return () => {
        audio.removeEventListener("loadedmetadata", notify)
        audio.removeEventListener("durationchange", notify)
      }
    },
    [audio]
  )
  const time = useSyncExternalStore(everyFrame, () => audio.currentTime)
  const duration = useSyncExternalStore(subscribeMetadata, () =>
    Number.isFinite(audio.duration) ? audio.duration : 0
  )

  return (
    <ScrubBarContainer
      duration={duration}
      value={time}
      onScrub={(next) => supportClient.seek(next)}
      className="hidden w-48 gap-2 text-xs text-muted-foreground sm:flex"
    >
      <ScrubBarTimeLabel time={time} />
      <ScrubBarTrack
        aria-label="Seek audio"
        tabIndex={0}
        className="h-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onKeyDown={(ev) => {
          if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return
          ev.preventDefault()
          supportClient.seek(time + (ev.key === "ArrowRight" ? 5 : -5))
        }}
      >
        <ScrubBarProgress />
        <ScrubBarThumb className="size-3" />
      </ScrubBarTrack>
      <ScrubBarTimeLabel time={duration} />
    </ScrubBarContainer>
  )
}

interface VoiceDockProps {
  status: AgentStatus
  micStream: MediaStream | null
  playback: Playback | null
  closed: boolean
  onStop: () => void
}

// The bars follow the mic while recording and the playing ElevenLabs audio
// while speaking. Browser speech has no stream to read, so the bars stay calm.
// When nothing is happening the dock shows how to talk instead.
export function VoiceDock({
  status,
  micStream,
  playback,
  closed,
  onStop,
}: VoiceDockProps) {
  const reduceMotion = useReducedMotion()
  const live = isActive(status)
  const mapped = VISUALIZER_STATE[status]
  const driven = mapped === "listening" || mapped === "speaking"
  const state = reduceMotion && !driven ? undefined : mapped
  const stream =
    status === "listening"
      ? micStream
      : status === "speaking"
        ? (playback?.stream ?? null)
        : null

  return (
    <div
      role="group"
      aria-label="Voice activity"
      className={cn(
        "surface-flip flex h-11 shrink-0 items-center gap-3 rounded-lg px-3",
        live
          ? "dark bg-background text-foreground [--primary:var(--vivid)]"
          : ""
      )}
    >
      {live ? (
        <BarVisualizer
          state={state}
          mediaStream={stream}
          barCount={44}
          minHeight={25}
          centerAlign
          barClassName={cn("max-w-[3px] min-w-[3px]", driven && "bg-primary")}
          className="h-[22px] min-w-0 flex-1 justify-start gap-[3px] overflow-hidden rounded-none bg-transparent p-0"
        />
      ) : (
        <p className="min-w-0 flex-1 truncate text-center eyebrow">
          {closed ? (
            <>
              <span className="max-md:hidden">
                Conversation closed · start a new session
              </span>
              <span className="md:hidden">Conversation closed</span>
            </>
          ) : (
            <>
              <span className="max-md:hidden">
                Hold <Kbd>Space</Kbd> to talk, or click the microphone
              </span>
              <span className="md:hidden">Tap the microphone to talk</span>
            </>
          )}
        </p>
      )}
      {playback && (
        <div className="flex shrink-0 items-center gap-2">
          {playback.mode === "elevenlabs" && playback.audio ? (
            <PlaybackScrubber audio={playback.audio} />
          ) : (
            <span className="eyebrow">Browser voice</span>
          )}
          <Button variant="ghost" size="sm" onClick={onStop}>
            <SquareIcon data-icon="inline-start" />
            <span className="max-sm:sr-only">Stop audio</span>
          </Button>
        </div>
      )}
    </div>
  )
}
