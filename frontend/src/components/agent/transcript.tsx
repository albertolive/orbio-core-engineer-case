import { useState } from "react"
import { useReducedMotion } from "motion/react"
import {
  BanIcon,
  BookOpenIcon,
  CircleCheckIcon,
  HeadsetIcon,
  Volume2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ui/conversation"
import { Message, MessageContent } from "@/components/ui/message"
import { ShimmeringText } from "@/components/ui/shimmering-text"
import { useSourceFocus } from "@/components/source-focus"
import { NumberBadge } from "@/components/number-badge"
import { supportClient, useSupport } from "@/hooks/use-support"
import type { ConversationSession, ConversationTurn } from "@/lib/types"
import { cn } from "@/lib/utils"

// Orbio call-card bubbles: 16px radius, one 4px "tail" corner next to the label.
// The size is arbitrary on purpose: this repo's `cn` reads a custom `text-body`
// as a colour and would drop the bubble's text colour.
const BUBBLE =
  "max-w-full rounded-2xl text-[0.9375rem]/[1.55] whitespace-pre-wrap"
const USER_BUBBLE = cn(BUBBLE, "rounded-tr-sm")
const NOVA_BUBBLE = cn(
  BUBBLE,
  "rounded-tl-sm border group-[.is-assistant]:bg-background"
)

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
})

function Meta({ label, at }: { label: string; at: string }) {
  const date = new Date(at)
  return (
    <p className="px-1 text-[0.6875rem] font-semibold text-subtle">
      {label}
      {!Number.isNaN(date.getTime()) && (
        <>
          {" · "}
          <time dateTime={at}>{clock.format(date)}</time>
        </>
      )}
    </p>
  )
}

function CitationBadge({
  session,
  turn,
  chunkId,
}: {
  session: ConversationSession
  turn: ConversationTurn
  chunkId: string
}) {
  const { focus, cite } = useSourceFocus()
  const index = turn.retrieved_chunks.findIndex((c) => c.chunk_id === chunkId)
  const chunk = turn.retrieved_chunks[index]
  const active =
    focus?.sessionId === session.session_id &&
    focus.turnId === turn.turn_id &&
    focus.chunkId === chunkId
  const title = chunk?.title ?? chunkId

  return (
    <Badge
      asChild
      variant="outline"
      className="h-7 max-w-full gap-1.5 pr-2.5 pl-1 max-md:h-8"
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label={`Source ${index + 1}: ${title}${chunk ? `, score ${chunk.score.toFixed(2)}` : ""}`}
        data-active={active}
        className="cursor-pointer data-[active=true]:border-signal data-[active=true]:bg-signal/15"
        onClick={() =>
          cite({ sessionId: session.session_id, turnId: turn.turn_id, chunkId })
        }
      >
        {chunk ? (
          <NumberBadge
            n={index + 1}
            className="size-5 rounded-full text-[0.625rem] max-md:size-6"
          />
        ) : (
          <BookOpenIcon data-icon="inline-start" />
        )}
        <span className="truncate">{title}</span>
        {chunk && (
          <span className="font-mono text-[0.6875rem] text-subtle tabular-nums">
            {chunk.score.toFixed(2)}
          </span>
        )}
      </button>
    </Badge>
  )
}

function TurnView({
  session,
  turn,
  animate,
}: {
  session: ConversationSession
  turn: ConversationTurn
  animate: boolean
}) {
  return (
    <div className={cn("flex flex-col gap-2", animate && "message-in")}>
      {turn.user_text && (
        <Message from="user" className="py-0">
          <div className="flex max-w-[85%] flex-col items-end gap-1">
            <Meta
              label={turn.metrics.stt_ms === null ? "You" : "You · voice"}
              at={turn.created_at}
            />
            <MessageContent className={USER_BUBBLE}>
              {turn.user_text}
            </MessageContent>
          </div>
        </Message>
      )}
      <Message from="assistant" className="py-0">
        <div className="flex max-w-[88%] flex-col items-start gap-1">
          <Meta
            label={`Nova · ${turn.turn_id} · ${turn.language.toUpperCase()}`}
            at={turn.created_at}
          />
          <MessageContent lang={turn.language} className={NOVA_BUBBLE}>
            {turn.reply_text}
          </MessageContent>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1">
            {turn.cited_kb_ids.map((chunkId) => (
              <CitationBadge
                key={chunkId}
                session={session}
                turn={turn}
                chunkId={chunkId}
              />
            ))}
            <Button
              variant="ghost"
              size="xs"
              className="max-md:h-8"
              onClick={() => void supportClient.playTurnAudio(turn)}
            >
              <Volume2Icon data-icon="inline-start" />
              Play audio
            </Button>
          </div>
        </div>
      </Message>
    </div>
  )
}

function TypingDots() {
  return (
    <span className="flex h-[1.55em] items-center gap-1.5" aria-hidden>
      <span className="typing-dot size-1.5 rounded-full bg-subtle" />
      <span className="typing-dot size-1.5 rounded-full bg-subtle" />
      <span className="typing-dot size-1.5 rounded-full bg-subtle" />
    </span>
  )
}

function Pending({ text }: { text: string | null }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="message-in flex flex-col gap-2" aria-live="polite">
      <Message from="user" className="py-0">
        <MessageContent className={cn(USER_BUBBLE, "max-w-[85%] opacity-70")}>
          {text ??
            (reduceMotion ? (
              "Transcribing your voice…"
            ) : (
              <ShimmeringText
                text="Transcribing your voice…"
                color="currentColor"
                shimmerColor="var(--lime-bright)"
              />
            ))}
        </MessageContent>
      </Message>
      {text !== null && (
        <Message from="assistant" className="py-0">
          <MessageContent className={NOVA_BUBBLE}>
            <TypingDots />
            <span className="sr-only">Nova is thinking…</span>
          </MessageContent>
        </Message>
      )}
    </div>
  )
}

// Terminal state in plain words, derived from the session so it also shows
// when a closed session is restored from storage.
function closingNote(session: ConversationSession) {
  switch (session.phase) {
    case "completed":
      return {
        Icon: CircleCheckIcon,
        text: `Ticket ${session.validated_ticket?.ticket_id ?? ""} created`,
      }
    case "escalated":
      return { Icon: HeadsetIcon, text: "Handed to a human specialist" }
    case "canceled":
      return { Icon: BanIcon, text: "Ticket request canceled" }
    default:
      return null
  }
}

function ClosingNote({ session }: { session: ConversationSession }) {
  const note = closingNote(session)
  if (!note) return null
  return (
    <div className="message-in flex justify-center pt-1">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[0.6875rem] font-semibold text-lime">
        <note.Icon className="size-3.5" aria-hidden />
        {note.text}
      </p>
    </div>
  )
}

function TranscriptView({
  session,
  pending,
  transcribing,
}: {
  session: ConversationSession
  pending: string | null
  transcribing: boolean
}) {
  // Turns already present when this session was shown do not animate in.
  const [initialCount] = useState(session.turns.length)
  const scroll = useReducedMotion() ? "instant" : "smooth"

  return (
    <Conversation className="min-h-0 flex-1" initial={scroll} resize={scroll}>
      <ConversationContent className="gap-5 px-4 py-4 md:px-5">
        {session.turns.map((turn, index) => (
          <TurnView
            key={turn.turn_id}
            session={session}
            turn={turn}
            animate={index >= initialCount}
          />
        ))}
        {pending !== null && <Pending text={pending} />}
        {transcribing && <Pending text={null} />}
        <ClosingNote session={session} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

export function Transcript() {
  const { session, busy, pending } = useSupport()
  if (!session) {
    return (
      <div className="min-h-0 flex-1">
        <ConversationEmptyState
          title="Connecting to Nova"
          description="Starting a support session…"
        />
      </div>
    )
  }
  return (
    <TranscriptView
      key={session.session_id}
      session={session}
      pending={pending}
      transcribing={busy === "voice"}
    />
  )
}
