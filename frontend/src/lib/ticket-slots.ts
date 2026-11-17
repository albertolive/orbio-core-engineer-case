export interface TicketSlotDef {
  readonly key: string
  readonly label: string
}

// One row per ticket slot. Adding a slot to the UI is one line here: the
// TicketDraft type below and the ticket card both derive from this array.
// Slot values are optional because a slot the backend does not send yet just
// reads as pending.
export const TICKET_SLOTS = [
  { key: "order_number", label: "Order number" },
  { key: "problem_category", label: "Problem category" },
  { key: "urgency_level", label: "Urgency" },
  { key: "problem_description", label: "Problem description" },
] as const satisfies readonly TicketSlotDef[]

export type TicketSlotKey = (typeof TICKET_SLOTS)[number]["key"]
export type TicketSlot = TicketSlotDef & { readonly key: TicketSlotKey }

export type TicketDraft = { [K in TicketSlotKey]?: string | null } & {
  field_errors: Record<string, string>
}

export type SlotStatus = "pending" | "filled" | "invalid"

export function slotStatus(draft: TicketDraft, key: TicketSlotKey): SlotStatus {
  if (draft.field_errors[key]) return "invalid"
  return draft[key] ? "filled" : "pending"
}

export function filledSlotCount(draft: TicketDraft): number {
  return TICKET_SLOTS.filter(({ key }) => slotStatus(draft, key) === "filled")
    .length
}

// "damaged_item" -> "Damaged item"; free text and order codes pass through.
export function humanize(value: string): string {
  if (!/^[a-z]+(_[a-z]+)*$/.test(value)) return value
  const spaced = value.replaceAll("_", " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
