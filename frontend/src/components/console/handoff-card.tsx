import { UserRoundCheckIcon } from "lucide-react"

import { StatusPill } from "@/components/console/status-pill"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FRUSTRATION_IMMEDIATE, FRUSTRATION_SUSTAINED } from "@/lib/frustration"
import { TICKET_SLOTS, humanize } from "@/lib/ticket-slots"
import type {
  ConversationSession,
  ConversationSummary,
  EscalationReason,
} from "@/lib/types"

const SUMMARY_SOURCE: Record<ConversationSummary["generated_by"], string> = {
  llm: "AI summary",
  fallback: "Fallback summary",
}

const REASONS: Record<EscalationReason, { title: string; detail: string }> = {
  user_requested: {
    title: "The customer asked for a person",
    detail: "Nova stopped collecting fields and passed the conversation on.",
  },
  high_frustration: {
    title: "Frustration crossed the threshold",
    detail: `The score reached ${FRUSTRATION_IMMEDIATE}, or stayed at ${FRUSTRATION_SUSTAINED} or above for two turns.`,
  },
  repeated_invalid_order: {
    title: "Three invalid order numbers",
    detail:
      "The customer could not identify the order, so a person takes over.",
  },
}

function Handoff({ session }: { session: ConversationSession }) {
  const reason = session.escalation_reason
  if (!reason) return null
  const lastCustomerMessage = session.turns.findLast(
    (turn) => turn.user_text
  )?.user_text

  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
      <div className="flex items-start gap-2">
        <UserRoundCheckIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium text-destructive">
            {REASONS[reason].title}
          </p>
          <p className="text-xs text-muted-foreground">
            {REASONS[reason].detail}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {TICKET_SLOTS.map(({ key, label }) => (
          <div key={key} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-subtle">{label}</dt>
            <dd className="break-words">
              {session.draft[key]
                ? humanize(session.draft[key])
                : "Not provided"}
            </dd>
          </div>
        ))}
        {lastCustomerMessage && (
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-subtle">Last message</dt>
            <dd className="break-words">“{lastCustomerMessage}”</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function Summary({ session }: { session: ConversationSession }) {
  const { summary } = session
  if (!summary) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed">{summary.summary}</p>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-signal">
        {summary.key_points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  )
}

export function HandoffCard({ session }: { session: ConversationSession }) {
  const { summary, escalation_reason: reason } = session
  return (
    <Card>
      <CardHeader>
        <CardTitle>Specialist handoff &amp; summary</CardTitle>
        <CardDescription>Nova proposes. A person decides.</CardDescription>
        {summary && (
          <CardAction>
            <StatusPill>{SUMMARY_SOURCE[summary.generated_by]}</StatusPill>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Handoff session={session} />
        <Summary session={session} />
        {!reason && !summary && (
          <p className="text-sm text-muted-foreground">
            No handoff needed. A summary appears when the conversation closes,
            or use Generate summary.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
