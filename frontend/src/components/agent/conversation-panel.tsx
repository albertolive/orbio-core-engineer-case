import { AgentHeader } from "@/components/agent/agent-header"
import { Composer } from "@/components/agent/composer"
import { Transcript } from "@/components/agent/transcript"
import { VoiceDock } from "@/components/agent/voice-dock"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { supportClient, useSupport } from "@/hooks/use-support"
import { agentStatus } from "@/lib/agent-status"
import { isClosed } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TriangleAlertIcon, XIcon } from "lucide-react"

export function ConversationPanel({ className }: { className?: string }) {
  const state = useSupport()
  const { banner, micStream, playback } = state

  return (
    <section
      aria-label="Conversation"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-paper",
        className
      )}
    >
      <AgentHeader />
      {banner && (
        <Alert
          variant={banner.kind === "err" ? "destructive" : "default"}
          className={cn(
            "mx-4 mt-3 w-auto md:mx-5",
            banner.kind === "warn" && "text-warn"
          )}
        >
          <TriangleAlertIcon />
          <AlertDescription className="text-current">
            {banner.text}
          </AlertDescription>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss message"
            className="absolute top-1 right-1"
            onClick={() => supportClient.dismissBanner()}
          >
            <XIcon />
          </Button>
        </Alert>
      )}
      <Transcript />
      <footer className="border-t">
        <div className="px-4 pt-3 md:px-5">
          <VoiceDock
            status={agentStatus(state)}
            micStream={micStream}
            playback={playback}
            closed={isClosed(state.session)}
            onStop={() => supportClient.stopPlayback()}
          />
        </div>
        <Composer />
      </footer>
    </section>
  )
}
