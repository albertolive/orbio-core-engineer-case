import { useEffect, useRef, useState, type FormEvent } from "react"
import { MicIcon, SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { VoiceButton } from "@/components/ui/voice-button"
import { supportClient, useSupport } from "@/hooks/use-support"
import { PRESETS, type Preset } from "@/lib/presets"
import { isClosed } from "@/lib/types"

const MAX_MESSAGE_LENGTH = 4000

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      250
    )
    return () => {
      clearInterval(id)
      setSeconds(0)
    }
  }, [active])
  return seconds
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

function Presets({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (preset: Preset) => void
}) {
  return (
    <div
      role="group"
      aria-label="Sample prompts"
      className="-mx-1 flex scroll-thin gap-1 overflow-x-auto px-1 py-0.5 max-md:snap-x max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] max-md:pr-6 md:flex-wrap md:overflow-visible"
    >
      {PRESETS.map((preset) => (
        <Button
          key={preset.label}
          type="button"
          variant="outline"
          size="sm"
          title={preset.prompt}
          disabled={disabled}
          className="shrink-0 rounded-full px-2.5 text-[0.6875rem] max-md:h-8 max-md:snap-start"
          onClick={() => onPick(preset)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  )
}

function RecordingStrip({ seconds }: { seconds: number }) {
  return (
    <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-lg border bg-card px-3">
      <span
        className="size-2 shrink-0 animate-pulse rounded-full bg-destructive"
        aria-hidden
      />
      <span className="text-sm font-medium">Recording</span>
      <span className="font-mono text-xs tabular-nums">{clock(seconds)}</span>
      <span className="truncate eyebrow max-md:hidden">
        Release Space or click the mic to send
      </span>
    </div>
  )
}

export function Composer() {
  const { session, busy, recording, micStream } = useSupport()
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const seconds = useElapsedSeconds(recording)
  const closed = isClosed(session)
  const canSend =
    !closed && busy === null && !recording && draft.trim().length > 0

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const text = draft.trim()
    if (!text || !canSend) return
    const sent = await supportClient.sendText(text)
    // Keep anything the customer typed while the reply was on its way.
    if (sent) setDraft((current) => (current === draft ? "" : current))
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2.5 px-4 pt-3 pb-4 md:px-5"
    >
      <Presets
        disabled={closed}
        onPick={(preset) => {
          setDraft(preset.prompt.trim())
          inputRef.current?.focus()
        }}
      />
      <div className="flex items-center gap-2">
        {recording ? (
          <RecordingStrip seconds={seconds} />
        ) : (
          <InputGroup className="h-11 min-w-0 flex-1 rounded-lg bg-card has-disabled:bg-secondary has-disabled:opacity-70">
            <InputGroupInput
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              autoComplete="off"
              enterKeyHint="send"
              aria-label="Message"
              disabled={closed}
              placeholder={closed ? "Conversation closed" : "Type a message..."}
              className="h-full text-base md:text-sm"
              onChange={(ev) => setDraft(ev.target.value)}
            />
          </InputGroup>
        )}
        <VoiceButton
          size="icon"
          variant="outline"
          state={
            recording ? "recording" : busy === "voice" ? "processing" : "idle"
          }
          icon={<MicIcon />}
          mediaStream={micStream}
          aria-label={
            recording ? "Stop recording and send" : "Record voice message"
          }
          title="Hold Space or click to talk"
          disabled={closed || (busy !== null && !recording)}
          onPress={() => supportClient.toggleMic()}
          className="size-11 shrink-0 rounded-lg"
        />
        <Button
          type="submit"
          className="h-11 shrink-0 px-4"
          disabled={!canSend}
        >
          <SendIcon data-icon="inline-start" />
          Send
        </Button>
      </div>
    </form>
  )
}
