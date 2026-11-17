import { CheckIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react"

import { StatusPill } from "@/components/console/status-pill"
import { NumberBadge } from "@/components/number-badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  TICKET_SLOTS,
  filledSlotCount,
  humanize,
  slotStatus,
  type TicketDraft,
  type TicketSlot,
} from "@/lib/ticket-slots"
import type { ConversationSession, ValidatedTicket } from "@/lib/types"
import { cn } from "@/lib/utils"

const BADGE_TONE = {
  filled: "solid",
  invalid: "danger",
  pending: "pending",
} as const

// One cell of Orbio's rule grid: tile on top, text anchored to the bottom.
function SlotCell({
  index,
  slot,
  draft,
}: {
  index: number
  slot: TicketSlot
  draft: TicketDraft
}) {
  const status = slotStatus(draft, slot.key)
  const value = draft[slot.key]
  const error = draft.field_errors[slot.key]

  return (
    <li
      data-slot-key={slot.key}
      data-status={status}
      className="relative flex items-start gap-4 border-t p-(--card-spacing) first:border-t-0 @md:min-h-36 @md:flex-col @md:gap-5 @md:border-t-0 @md:odd:last:col-span-2"
    >
      <NumberBadge
        n={index + 1}
        tone={BADGE_TONE[status]}
        className="size-9 shrink-0 text-xs"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 pr-6 @md:mt-auto @md:w-full @md:pr-0">
        <p className="text-xs text-muted-foreground">{slot.label}</p>
        <p
          className={cn(
            "font-heading text-base leading-snug font-semibold tracking-[-0.015em] break-words transition-colors duration-300",
            !value && "text-subtle"
          )}
        >
          {value ? humanize(value) : "Pending"}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {status === "filled" && (
        <CheckIcon
          className="absolute top-(--card-spacing) right-(--card-spacing) size-4 text-signal"
          aria-label="Valid"
        />
      )}
      {status === "invalid" && (
        <TriangleAlertIcon
          className="absolute top-(--card-spacing) right-(--card-spacing) size-4 text-destructive"
          aria-label="Invalid"
        />
      )}
    </li>
  )
}

function CreatedTicket({ ticket }: { ticket: ValidatedTicket }) {
  const { item_summary, shipping_status, delivered_days_ago } =
    ticket.order_info
  return (
    <div className="flex items-start gap-3 border-t bg-signal/10 px-(--card-spacing) py-3">
      <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-signal" />
      <div className="min-w-0">
        <p className="font-heading text-sm font-semibold break-words">
          Ticket {ticket.ticket_id} created
        </p>
        <p className="text-xs text-muted-foreground">
          {item_summary} · {humanize(shipping_status)}
          {delivered_days_ago !== null && ` · ${delivered_days_ago} days ago`}
        </p>
      </div>
    </div>
  )
}

function ticketStatus(session: ConversationSession): string {
  if (session.validated_ticket) return "Submitted"
  if (session.phase === "confirming") return "Ready to confirm"
  return `${filledSlotCount(session.draft)} of ${TICKET_SLOTS.length} fields`
}

export function TicketCard({ session }: { session: ConversationSession }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="py-(--card-spacing)">
        <CardTitle>Ticket draft</CardTitle>
        <CardDescription>Nova drafts it. A person confirms it.</CardDescription>
        <CardAction>
          <StatusPill>{ticketStatus(session)}</StatusPill>
        </CardAction>
      </CardHeader>
      {session.validated_ticket && (
        <CreatedTicket ticket={session.validated_ticket} />
      )}
      <div className="@container border-t">
        <ol className="grid grid-cols-1 @md:grid-cols-2">
          {TICKET_SLOTS.map((slot, index) => (
            <SlotCell
              key={slot.key}
              index={index}
              slot={slot}
              draft={session.draft}
            />
          ))}
        </ol>
      </div>
    </Card>
  )
}
