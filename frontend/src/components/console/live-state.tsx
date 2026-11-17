import { GuardrailsSection } from "@/components/console/guardrails-section"
import { SourcesSection } from "@/components/console/sources-section"
import { TelemetrySection } from "@/components/console/telemetry-section"
import { Card } from "@/components/ui/card"
import type { TtsInfo } from "@/lib/support-client"
import type { ConversationSession } from "@/lib/types"

// Orbio's Trust Center card: one container, groups split by a label and a hairline.
export function LiveState({
  session,
  tts,
}: {
  session: ConversationSession
  tts: TtsInfo
}) {
  return (
    <Card className="gap-6">
      <GuardrailsSection session={session} />
      <SourcesSection session={session} />
      <TelemetrySection session={session} tts={tts} />
    </Card>
  )
}
