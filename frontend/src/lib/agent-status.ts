import type { SupportState } from "@/lib/support-client"

export type AgentStatus =
  "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "escalated"

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  listening: "Listening",
  transcribing: "Transcribing",
  thinking: "Thinking",
  speaking: "Speaking",
  escalated: "Escalated",
}

// Live activity wins over the resting escalated state. Fetching the reply's
// audio still counts as thinking, so the agent does not flash idle before it speaks.
export function agentStatus(
  state: Pick<
    SupportState,
    "recording" | "busy" | "playback" | "audioLoading" | "session"
  >
): AgentStatus {
  if (state.recording) return "listening"
  if (state.busy === "voice") return "transcribing"
  if (state.busy) return "thinking"
  if (state.playback) return "speaking"
  if (state.audioLoading) return "thinking"
  if (state.session?.phase === "escalated") return "escalated"
  return "idle"
}

export const isActive = (status: AgentStatus): boolean =>
  status !== "idle" && status !== "escalated"
