import { SectionLabel } from "@/components/console/section-label"
import { Progress } from "@/components/ui/progress"
import {
  FRUSTRATION_IMMEDIATE,
  FRUSTRATION_SUSTAINED,
  MAX_INVALID_ORDER_ATTEMPTS,
  frustrationTone,
} from "@/lib/frustration"
import { latestTurn, type ConversationSession } from "@/lib/types"
import { cn } from "@/lib/utils"

const TONE_LABEL = {
  calm: "Calm",
  elevated: `Elevated, ${FRUSTRATION_SUSTAINED} and above`,
  critical: `Escalation threshold, ${FRUSTRATION_IMMEDIATE} and above`,
} as const

export function GuardrailsSection({
  session,
}: {
  session: ConversationSession
}) {
  const score = latestTurn(session)?.frustration_score ?? 0
  const tone = frustrationTone(score)
  const attempts = session.invalid_order_attempts

  return (
    <div className="flex flex-col gap-4 px-(--card-spacing)">
      <SectionLabel>Sentiment &amp; guardrails</SectionLabel>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Customer frustration score
          </span>
          <strong className="font-heading font-semibold tabular-nums">
            {score} / 100
          </strong>
        </div>
        <div className="relative pb-4">
          <Progress
            value={score}
            data-tone={tone}
            aria-label="Customer frustration score"
            className="h-2 [&>div]:bg-signal data-[tone=critical]:[&>div]:bg-destructive data-[tone=elevated]:[&>div]:bg-warn"
          />
          {[FRUSTRATION_SUSTAINED, FRUSTRATION_IMMEDIATE].map((mark) => (
            <span
              key={mark}
              aria-hidden
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${mark}%` }}
            >
              <span className="h-2 w-px bg-foreground/60" />
              <span className="mt-0.5 text-[0.6875rem] text-subtle tabular-nums">
                {mark}
              </span>
            </span>
          ))}
        </div>
        <p
          data-tone={tone}
          className={cn(
            "text-xs text-muted-foreground",
            tone === "elevated" && "text-warn",
            tone === "critical" && "text-destructive"
          )}
        >
          {TONE_LABEL[tone]}. Python escalates at {FRUSTRATION_IMMEDIATE}, or
          after two turns at {FRUSTRATION_SUSTAINED} and above.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Invalid order attempts</span>
        <span className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            {Array.from({ length: MAX_INVALID_ORDER_ATTEMPTS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "size-2 rounded-full border transition-colors duration-300",
                  i < attempts
                    ? "border-destructive bg-destructive"
                    : "border-subtle"
                )}
              />
            ))}
          </span>
          <strong className="font-heading font-semibold tabular-nums">
            {attempts} / {MAX_INVALID_ORDER_ATTEMPTS}
          </strong>
        </span>
      </div>

      {session.escalation_reason && (
        <p role="status" className="text-sm text-destructive">
          Escalated to human specialist ({session.escalation_reason})
        </p>
      )}
    </div>
  )
}
