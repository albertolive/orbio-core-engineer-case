import { SectionLabel } from "@/components/console/section-label"
import type { TtsInfo } from "@/lib/support-client"
import { latestTurn, type ConversationSession } from "@/lib/types"

const ms = (value: number | null | undefined): string =>
  value == null ? "-" : `${Math.round(value)}ms`

export function TelemetrySection({
  session,
  tts,
}: {
  session: ConversationSession
  tts: TtsInfo
}) {
  const latest = latestTurn(session)
  // The greeting turn never went through the pipeline, so it has no timings.
  const metrics = latest?.user_text != null ? latest.metrics : null

  const cells = [
    { label: "STT", value: ms(metrics?.stt_ms) },
    { label: "RAG", value: metrics ? ms(metrics.rag_ms) : "-" },
    { label: "LLM", value: metrics ? ms(metrics.llm_ms) : "-" },
    { label: "TTS", value: ms(tts.fetchMs) },
    {
      label: "Tokens",
      value: metrics ? `${metrics.input_tokens}/${metrics.output_tokens}` : "-",
    },
  ]

  return (
    <div className="flex flex-col gap-3 px-(--card-spacing)">
      <SectionLabel
        aside={
          <span className="text-[0.6875rem] text-subtle">latest turn</span>
        }
      >
        Telemetry
      </SectionLabel>
      {/* Orbio's tile: bold value over a small muted label. */}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-2">
        {cells.map(({ label, value }) => (
          <div
            key={label}
            className="flex flex-col-reverse items-center gap-0.5 rounded-md border px-2.5 py-3 text-center"
          >
            <dt className="text-[0.65625rem] text-subtle">{label}</dt>
            <dd className="font-heading text-[0.8125rem] font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
        <dt className="text-subtle">X-TTS-Provider</dt>
        <dd className="break-all">{tts.provider ?? "pending"}</dd>
        <dt className="text-subtle">X-TTS-Degraded</dt>
        <dd className="break-all">{tts.degraded ?? "none"}</dd>
        {latest?.error_note && (
          <>
            <dt className="text-subtle">error_note</dt>
            <dd className="break-all text-destructive">{latest.error_note}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
