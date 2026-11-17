import type { TicketDraft } from "@/lib/ticket-slots"

export type Language = "en" | "es" | "ca"
export type Phase =
  "collecting" | "confirming" | "completed" | "escalated" | "canceled"
export type EscalationReason =
  "user_requested" | "high_frustration" | "repeated_invalid_order"

export const TERMINAL_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  "completed",
  "escalated",
  "canceled",
])

export interface OrderInfo {
  order_number: string
  item_summary: string
  shipping_status: string
  delivered_days_ago: number | null
}

export interface RetrievedChunk {
  chunk_id: string
  title: string
  content: string
  score: number
}

export interface TurnMetrics {
  stt_ms: number | null
  rag_ms: number
  llm_ms: number
  input_tokens: number
  output_tokens: number
}

export interface ConversationTurn {
  turn_id: string
  client_turn_id: string | null
  created_at: string
  user_text: string | null
  reply_text: string
  language: Language
  frustration_score: number | null
  cited_kb_ids: string[]
  retrieved_chunks: RetrievedChunk[]
  metrics: TurnMetrics
  error_note: string | null
}

export interface ValidatedTicket {
  ticket_id: string
  order_number: string
  problem_category: string
  problem_description: string
  urgency_level: string
  order_info: OrderInfo
}

export interface ConversationSummary {
  summary: string
  key_points: string[]
  outcome: Phase
  escalation_reason: EscalationReason | null
  generated_by: "llm" | "fallback"
}

export interface ConversationSession {
  session_id: string
  created_at: string
  updated_at: string
  phase: Phase
  language: Language
  draft: TicketDraft
  validated_ticket: ValidatedTicket | null
  escalation_reason: EscalationReason | null
  invalid_order_attempts: number
  summary: ConversationSummary | null
  turns: ConversationTurn[]
}

export interface Health {
  status: string
  tts_provider: string
}

export const isClosed = (session: ConversationSession | null): boolean =>
  session !== null && TERMINAL_PHASES.has(session.phase)

export const latestTurn = (
  session: ConversationSession | null
): ConversationTurn | undefined => session?.turns.at(-1)
